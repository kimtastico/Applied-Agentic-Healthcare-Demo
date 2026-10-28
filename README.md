# Plainly: medical words, explained

Paste a phrase from a discharge note or lab report, like *"mild bilateral pleural effusion,"* and get a plain-English explanation at a 6th-grade reading level.

- **Runs on Cloudflare Workers.** Static site in `public/`, API in `src/`, no runtime npm dependencies.
- **Uses NVIDIA's LLM API** (OpenAI-compatible, `integrate.api.nvidia.com`) with **temperature 0**. These are factual definitions, so creativity is a bug.
- **Uses Supabase** to build a public glossary of the most-searched terms. **Only the term is logged, never the user.**
- **Works before either service is connected.** With no keys set, it runs in demo mode with three built-in examples and no glossary.

## How it works

```
Browser ──POST /api/explain──▶ Worker ──▶ Supabase: same term cached under this prompt? ──yes──▶ reuse it
                                  │                                                        no
                                  │                                                        ▼
                                  │                                  NVIDIA chat completions (temperature 0, JSON only)
                                  │                                                        │
                                  └──── background: record_search(term) ◀──────────────────┘
```

1. The phrase is normalized (lowercase, collapsed whitespace). If it's already a glossary term, the stored explanation is returned, so the same term always gets the same answer.
2. Otherwise the model returns strict JSON: `understood`, a cleaned `term`, `has_personal_info`, `explanation`, `word_parts`, and `questions`.
3. The Worker estimates the Flesch-Kincaid grade of the explanation and shows it to the user as a check on the 6th-grade target.
4. In the background (`ctx.waitUntil`), the Worker calls the Supabase function `record_search` to count the term.

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
src/worker.js      routes: POST /api/explain, GET /api/glossary, GET /api/health
src/nvidia.js      NVIDIA chat-completions call (temperature 0)
src/prompt.js      system prompt + PROMPT_VERSION
src/supabase.js    fetch-based PostgREST client
src/lib.js         pure helpers: normalization, privacy filters, JSON parsing, readability
src/demo.js        built-in answers for demo mode
supabase/migrations/0001_glossary.sql   table, RLS, record_search()
test/lib.test.js   unit tests (node --test)
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

### 2. Connect NVIDIA

1. Get an API key at https://build.nvidia.com.
2. Copy `.dev.vars.example` to `.dev.vars` and set `NVIDIA_API_KEY`.
3. Optionally change `NVIDIA_MODEL` in `wrangler.jsonc`. The default is `nvidia/nemotron-3-ultra-550b-a55b`. Any text chat model with a Free Endpoint on build.nvidia.com works, including reasoning models (their `<think>` text is ignored).

### 3. Connect Supabase

1. Create a project and run `supabase/migrations/0001_glossary.sql` in the SQL editor (or `supabase db push`).
2. In `.dev.vars`, set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` to a **secret / service_role** key. Only the Worker ever sees it. Row-level security lets anyone read the glossary, but only `record_search` (service role only) can write to it.

### 4. Deploy to Cloudflare

```bash
npx wrangler login
```

```bash
npx wrangler secret put NVIDIA_API_KEY
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

Edit `src/prompt.js` and **bump `PROMPT_VERSION`**. Cached explanations from the old version are skipped and regenerated the next time someone searches that term.

## API

| Route | Description |
| --- | --- |
| `POST /api/explain` `{"phrase": "..."}` | Returns `{term, understood, explanation, word_parts, questions, reading_grade, source, logged}`. `source` is `ai`, `glossary`, or `demo`. Limited to 10 requests per minute per visitor. |
| `GET /api/glossary` | Top 50 terms by search count. Cached at the edge for 60 seconds. |
| `GET /api/health` | Shows which services are configured. |

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
