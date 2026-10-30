---
name: review-explanation
description: Grade a Plainly answer (a plain-English explanation of a medical phrase) against the site's five rules (no causes, reading grade 6 or below, correct word roots, no personal details, care-team questions) and say exactly what to fix. Use this whenever someone pastes or screenshots an answer from the site or /api/explain, asks whether an explanation is good, too hard to read, or "giving medical advice", compares answers from two models, or is about to change src/prompt.js or the AI models and wants to check output quality.
---

# Review a Plainly explanation

Plainly turns phrases from discharge notes and lab reports into plain English for patients. Patients act on what they read, so a friendly but wrong or over-reaching answer is worse than a short one. This skill checks one answer against the site's rules and produces a scorecard.

## 1. Get the answer

The answer arrives in one of these forms:
- **JSON** from `/api/explain`, with `term`, `explanation`, `word_parts`, `questions`, `reading_grade`, `source`.
- **A screenshot** of the result card. Transcribe it: the heading is the term, the paragraph is the explanation, "Word by word" holds the word parts, and the bullets are the questions.
- **Plain text.** Treat it as the explanation alone, and mark the rules it can't support as "not checked".

If the user also gave the original input (e.g. `potassium 5.8 mmol/L` or a phrase with a name in it), keep it. Rules 1 and 4 depend on it.

The rules come from `src/prompt.js`. If that file has changed in ways that conflict with this skill, follow `src/prompt.js` and mention the mismatch.

## 2. Run the checker

Run this from the repo root, with the answer as JSON (or plain text) in a file, or piped in with `-`:

```bash
node .claude/skills/review-explanation/scripts/check.mjs <file>
echo '{"explanation": "...", "word_parts": [...], "questions": [...]}' | node .claude/skills/review-explanation/scripts/check.mjs -
```

It reports the reading grade, using the same Flesch-Kincaid function as the site's grade pill. It also reports sentence lengths, phrases that often signal causes or advice, personal-detail patterns, word parts that repeat the term, and the question count. Treat the flags as leads to check, not verdicts. "Can happen" in a question is fine, but the same words in the explanation are not.

## 3. Apply the five rules

**Rule 1: No causes, advice, or predictions in the explanation or word parts.**
The explanation says what the phrase *means*, nothing more. A patient who reads "this can happen after surgery" may assume that's their cause. Fail for:
- causes, risk factors, or "when it happens", even common or true ones;
- tests, treatment, or what to do;
- what will happen next;
- reassurance the model can't know, such as "not serious" or "usually goes away".

Questions are the exception. "What caused this?" is how the site sends causes to the care team. For lab values, the answer should explain what the test measures and leave judging the number to the care team, and it fails if it calls the number high, low, normal, or dangerous.

**Rule 2: Reading grade 6 or below.**
Use the checker's grade. Above 6 fails. When it fails, name the hard words that pushed it up and suggest plain swaps, like "inflate" → "fill with air". The medical term itself is allowed and counts toward the grade. A plain rewrite of atelectasis scores about 2.5, so a high grade means the wording needs fixing. The prompt also asks for 2 to 4 sentences of 12 words or fewer. Note any misses but don't fail on them alone.

**Rule 3: Correct word roots.**
Check every word part against `references/word-roots.md`. Read it rather than relying on memory, which is how "leuko = white blood cell" slipped through. Fail if:
- a root is given more than its own meaning ("leuko" = white, not "white blood cell");
- a meaning is wrong (e.g. "collapse = fills with fluid");
- the whole term is repeated as a "part";
- an everyday word like "lung" is defined.

A unit of measure must be spelled out part by part, each part starting with its full name (e.g. "mmol" = millimoles, "L" = liter; the reference lists the common ones). It fails if a part isn't spelled out, or if it gives a normal range or any number. Those full names are long words, but like the medical term they don't count against rule 2. An empty word-parts list passes. The prompt prefers no parts over a guess. If a root isn't in the reference and you aren't confident, say "unverified" rather than pass or fail.

**Rule 4: No personal details.**
The answer must never repeat names, dates, ID numbers, places, or other details about a person, even if the input contained them. The site's whole promise is that nothing about the person is kept or echoed. "You" and "your" are fine. The term must also be clean, because it is saved to the public glossary.

**Rule 5: Care-team questions.**
There must be 1 or 2 short questions, worded as something the patient asks their care team. Fail if there are none, more than 3, or if a "question" is really advice ("You should rest").

**Not-understood answers** (non-medical input, like "banana bread") should say so in one sentence, with no word parts and no questions. Grade them only on that.

## 4. Report

Use this format:

```
## Review: <term>

| Rule | Result | Evidence |
| --- | --- | --- |
| 1. No causes or advice | PASS / FAIL | quote the offending words, or "none found" |
| 2. Reading grade ≤ 6 | PASS / FAIL | grade X.X; hardest words: ... |
| 3. Correct word roots | PASS / FAIL / UNVERIFIED | each wrong part, with the correct meaning |
| 4. No personal details | PASS / FAIL | ... |
| 5. Care-team questions | PASS / FAIL | count and any problem |

**Verdict:** PASS (all five) or FAIL (n of 5)

**Suggested rewrite:** only when something failed. Write a corrected version that passes, so the fix is concrete.

**Likely fix in the code:** only when the same failure would repeat. Name what to change in `src/prompt.js` (a rule, or a worked example in EXAMPLES), and remind the user to bump PROMPT_VERSION so saved answers regenerate.
```

Quote the answer's own words as evidence. Vague findings like "too complex" don't tell anyone what to change.
