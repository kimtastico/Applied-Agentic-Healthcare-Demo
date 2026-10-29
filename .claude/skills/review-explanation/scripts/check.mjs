// Mechanical checks for a Plainly answer. Uses the site's own mechanicalChecks from
// src/lib.js (the same checks the website's reviewer step runs), so the reading grade
// here always matches the grade pill on the site.
//
// Usage: node .claude/skills/review-explanation/scripts/check.mjs <file>
//   <file> holds /api/explain JSON, or plain text (treated as the explanation).
//   Use "-" to read from stdin: echo '{"explanation": "..."}' | node check.mjs -
// Prints JSON. Flags are leads for the reviewer, not verdicts.

import { readFileSync } from "node:fs";

const { mechanicalChecks, normalizePhrase } = await import(new URL("../../../../src/lib.js", import.meta.url));

const path = process.argv[2];
if (!path) {
  console.error("Usage: node check.mjs <file with /api/explain JSON or plain text>");
  process.exit(1);
}

const raw = readFileSync(path === "-" ? 0 : path, "utf8").trim();
let answer;
try {
  answer = JSON.parse(raw);
} catch {
  answer = { explanation: raw };
}

const wordParts = Array.isArray(answer.word_parts) ? answer.word_parts : [];
console.log(
  JSON.stringify(
    {
      term: normalizePhrase(answer.term ?? "") || null,
      ...mechanicalChecks(answer),
      word_parts: wordParts.map((p) => `${p?.word} = ${p?.meaning}`),
    },
    null,
    2,
  ),
);
