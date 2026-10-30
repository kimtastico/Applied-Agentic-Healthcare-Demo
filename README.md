# Plainly: medical words, explained

Paste a phrase from a discharge note or lab report, like *"mild bilateral pleural effusion,"* and get a plain-English explanation at a 6th-grade reading level.

- **Runs on Cloudflare Workers.** Static site in `public/`, API in `src/`, no runtime npm dependencies.
- **Uses AI models on Cloudflare Workers AI** (free daily allowance), with **NVIDIA's free API** (`integrate.api.nvidia.com`) as a backup, always at **temperature 0**. These are factual definitions, so creativity is a bug.
- **A writer AI drafts and a reviewer AI checks every new answer** against the site's rules before it's shown or saved.
- **Uses Supabase** to build a public glossary of the most-searched terms. **Only the term is logged, never the user.**
- **Works before any service is connected.** With no AI set up, it runs in demo mode with three built-in examples and no glossary.

## How it works

```
Browser ──POST /api/explain──▶ Worker ──▶ Supabase: same term cached under this prompt? ──yes──▶ reuse it
                                  │                                                        no
                                  │                                                        ▼
                                  │                         Writer AI drafts (temperature 0, JSON only)
                                  │                                                        ▼
                                  │                         Code checks: reading grade, cause phrases, personal details
                                  │                                                        ▼
                                  │                         Reviewer AI checks the draft against the five rules
                                  │                         and returns it approved, or a corrected version
                                  │                                                        │
                                  └──── background: record_search(term) ◀──────────────────┘
```

1. The phrase is normalized (lowercase, collapsed whitespace). If it's already a glossary term, the stored explanation is returned, so the same term always gets the same answer.
2. Otherwise the **writer** model returns strict JSON: `understood`, a cleaned `term`, `has_personal_info`, `explanation`, `word_parts`, and `questions`.
3. Code runs the checks a computer can do (`mechanicalChecks` in `src/lib.js`). The **reviewer** model then checks the draft against the five rules (no causes or advice, grade 6 or below, correct word roots, no personal details, care-team questions), using those results as leads. If it finds problems, its corrected version replaces the draft. The page shows "Checked by reviewer AI" or "Corrected by reviewer AI", and lists what was fixed.
4. **Final check:** if the reviewer rewrote the answer, the code checks run once more on its version, because nobody else has checked that text. A correction that still sounds like a cause or advice, reads above grade 7, repeats the term as a word part, has personal details, or has no care-team questions is shown as "Issues flagged: not saved". Only answers the reviewer approved, or corrections that pass this check, are saved to the glossary, along with what the reviewer found. If the reviewer is unavailable, the visitor still gets the draft, marked "Not yet reviewed", and it isn't saved.
5. The Worker estimates the Flesch-Kincaid grade of the explanation and shows it to the user as a check on the 6th-grade target.
6. In the background (`ctx.waitUntil`), the Worker calls the Supabase function `record_search` to count the term.

The writer and reviewer each make one AI call, so a term's first search takes about twice as long. Every later search is instant from the glossary. Set `AI_REVIEW` to `"off"` in `wrangler.jsonc` to use the writer alone.

### Models and providers

| Role | Models, tried in order (`wrangler.jsonc`) |
| --- | --- |
| Writer (`WRITER_MODELS`) | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` (Workers AI), then NVIDIA's Nemotron 3 Ultra, then Nemotron 3.5 Lightning |
| Reviewer (`REVIEWER_MODELS`) | `@cf/openai/gpt-oss-120b` (Workers AI), then Nemotron 3 Ultra |

- **Workers AI** (`@cf/...` models) runs inside Cloudflare through the `AI` binding. It needs no key, and it is free on the Workers Free plan up to a daily allowance. Once that's used up, requests fail rather than bill, and the next model in the list takes over.
- **NVIDIA** (`integrate.api.nvidia.com`) is a free trial that is often overloaded, so it is the backup. It needs the `NVIDIA_API_KEY` secret.
- **The reviewer is a different model family** (gpt-oss) from the writer (Llama), so it doesn't share the writer's blind spots. Only strong models review: a weak reviewer over-corrects and can make a good answer worse. If no strong reviewer is available, the answer is marked "Not yet reviewed" and isn't saved.
- **Time limits:** each model gets 15 seconds (`MODEL_TIMEOUT_SECONDS`) before the next is tried. A 503 "overloaded" or 429 "rate-limited" answer gets one retry after a 1.5-second pause. Models that already failed in a request aren't tried again by the reviewer. The whole answer has a 55-second budget (`ANSWER_TIMEOUT_SECONDS`), and the review is skipped if the writer uses most of it.
- **`/api/health/ai`** makes one test call and lists every model attempt and how it went.

### What gets stored, and what doesn't

| Stored in Supabase | Never stored |
| --- | --- |
| The normalized medical term, e.g. `pleural effusion` | The text the user pasted |
| A search counter, first-seen time, and last-updated time | IP address, user agent, cookies, or any user/session ID |
| The generated explanation, but only when it describes exactly that term | Explanations of input that had a lab value or personal detail |

Safeguards:

- The model extracts the general term and strips numbers, names, and dates. "Mr. Smith has pleural effusion" is counted only as `pleural effusion`.
- `isLoggableTerm` rejects any term that is too long (over 8 words or 80 characters), has unusual characters, or matches a personal-info pattern (emails, phone numbers, dates, long digit runs, MRN/DOB, honorifics).
- If the input contained a lab value (`potassium 5.8 mmol/L`), only `potassium` is counted. The explanation isn't cached because it may refer to that value.
- Workers Logs keep only the Worker's own error messages, which never include user text (an echoed phrase is blanked out). Cloudflare's per-request invocation logs, which would record visitor IPs, are turned off in `wrangler.jsonc`. The rate limiter keys on IP, but only in Cloudflare's memory.
- The UI tells users to leave out names, dates, and IDs, and shows a badge when a term was counted.

## Project layout

```
public/            static site (index.html, app.js, styles.css, _headers with a strict CSP)
src/worker.js      routes: POST /api/explain, GET /api/glossary, GET /api/health, GET /api/health/ai
src/pipeline.js    writer → code checks → reviewer
src/models.js      AI calls for the writer and reviewer: Workers AI or NVIDIA, temperature 0, backup models
src/prompt.js      writer and reviewer prompts, worked examples, PROMPT_VERSION
src/supabase.js    fetch-based PostgREST client
src/lib.js         pure helpers: normalization, privacy filters, JSON parsing, readability
src/demo.js        built-in answers for demo mode
supabase/migrations/0001_glossary.sql   table, RLS, record_search()
test/              unit tests (node --test), including the writer/reviewer pipeline
```

## Setup

### 1. Run locally (demo mode)

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:8787 and try one of the example chips.

### 2. Connect the AI

**Workers AI** needs no setup: the `"ai"` binding in `wrangler.jsonc` connects it on deploy. With `npm run dev`, Workers AI calls go to your Cloudflare account, so run `npx wrangler login` first.

**NVIDIA (optional backup):**
1. Get an API key at https://build.nvidia.com.
2. Copy `.dev.vars.example` to `.dev.vars` and set `NVIDIA_API_KEY`.

To change models, edit `WRITER_MODELS` and `REVIEWER_MODELS` in `wrangler.jsonc`. `@cf/...` names run on Workers AI; anything else goes to NVIDIA. Reasoning models work too (their `<think>` text is ignored).

### 3. Connect Supabase

1. Create a project and run `supabase/migrations/0001_glossary.sql` in the SQL editor (or `supabase db push`).
2. In `.dev.vars`, set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to a **secret / service_role** key. Only the Worker ever sees it. Row-level security lets anyone read the glossary, but only `record_search` (service role only) can write to it.

### 4. Deploy to Cloudflare

```bash
npx wrangler login
```

```bash
npx wrangler secret put NVIDIA_API_KEY   # optional backup
```

```bash
npx wrangler secret put SUPABASE_URL
```

```bash
npx wrangler secret put SUPABASE_SERVICE_KEY
```

```bash
npm run deploy
```

You can also connect this repo to Cloudflare Workers Builds: the build command is empty and the deploy command is `npx wrangler deploy`.

## Changing the prompt

Edit the writer or reviewer prompt in `src/prompt.js` and **bump `PROMPT_VERSION`**. Cached explanations from the old version are skipped and regenerated the next time someone searches that term.

## API

| Route | Description |
| --- | --- |
| `POST /api/explain` `{"phrase": "..."}` | Returns `{term, understood, explanation, word_parts, questions, reading_grade, source, logged}`. `source` is `ai`, `glossary`, or `demo`. Limited to 10 requests per minute per visitor. |
| `GET /api/glossary` | Top 50 terms by search count. Cached at the edge for 60 seconds. |
| `GET /api/health` | Shows which services are configured. |
| `GET /api/health/ai` | Makes one test call to NVIDIA with a fixed word and shows the result, the time taken, or NVIDIA's exact error. |

## Tests

```bash
npm test
```

```bash
npm run check
```

`npm test` runs the unit tests. `npm run check` validates the Wrangler config and bundle without deploying.

## Disclaimer

This tool explains words, not a person's health. It is not medical advice. AI explanations can be wrong, even at temperature 0.
