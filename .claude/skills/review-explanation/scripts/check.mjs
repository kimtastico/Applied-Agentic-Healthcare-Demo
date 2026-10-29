// Mechanical checks for a Plainly answer. Uses the site's own helpers from src/lib.js,
// so the reading grade here always matches the grade pill on the site.
//
// Usage: node .claude/skills/review-explanation/scripts/check.mjs <file>
//   <file> holds /api/explain JSON, or plain text (treated as the explanation).
// Prints JSON. Flags are leads for the reviewer, not verdicts.

import { readFileSync } from "node:fs";

const lib = await import(new URL("../../../../src/lib.js", import.meta.url));

const path = process.argv[2];
if (!path) {
  console.error("Usage: node check.mjs <file with /api/explain JSON or plain text>");
  process.exit(1);
}

const raw = readFileSync(path, "utf8").trim();
let answer;
try {
  answer = JSON.parse(raw);
} catch {
  answer = { explanation: raw };
}

const explanation = String(answer.explanation ?? "");
const term = lib.normalizePhrase(answer.term ?? "");
const wordParts = Array.isArray(answer.word_parts) ? answer.word_parts : [];
const questions = Array.isArray(answer.questions) ? answer.questions : [];

const sentences = explanation.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
const wordCount = (s) => (s.match(/[A-Za-z0-9'-]+/g) || []).length;

// Phrases that usually mean a cause, advice, or prediction slipped into the explanation.
const CAUSE_OR_ADVICE = [
  /\bcan (happen|occur|be caused)\b/i,
  /\b(caused|triggered|brought on) by\b/i,
  /\b(due to|because of|results? from|as a result of)\b/i,
  /\b(after|following) (surgery|an? operation|an? infection)\b/i,
  /\brisk\b/i,
  /\b(common|often seen|usually seen) (in|with|after)\b/i,
  /\b(you should|try to|make sure|be sure to|drink|rest)\b/i,
  /\b(treat(ed|ment)?|medicine|medication|antibiotics?)\b/i,
  /\b(will|usually|often) (go away|get better|clear up|resolve)\b/i,
  /\bnot (serious|dangerous|a big deal)\b/i,
  /\b(too high|too low|is normal|is high|is low|dangerous)\b/i,
];
const causeFlags = CAUSE_OR_ADVICE.flatMap((re) => {
  const m = explanation.match(re);
  return m ? [m[0]] : [];
});

const personalFlags = [
  ["explanation", explanation],
  ["term", term],
  ...wordParts.map((p, i) => [`word_parts[${i}]`, `${p?.word ?? ""} ${p?.meaning ?? ""}`]),
].flatMap(([where, text]) => (lib.looksPersonal(text) ? [where] : []));

const grade = lib.fleschKincaidGrade(explanation);

console.log(
  JSON.stringify(
    {
      term: term || null,
      reading_grade: grade,
      reading_grade_ok: grade == null ? null : grade <= 6,
      sentences: sentences.length,
      words_per_sentence: sentences.map(wordCount),
      sentences_over_12_words: sentences.filter((s) => wordCount(s) > 12),
      possible_cause_or_advice: causeFlags,
      possible_personal_details_in: personalFlags,
      word_parts: wordParts.map((p) => `${p?.word} = ${p?.meaning}`),
      word_parts_repeating_term: wordParts
        .filter((p) => term && lib.normalizePhrase(p?.word ?? "") === term)
        .map((p) => p.word),
      question_count: questions.length,
      questions_not_ending_in_question_mark: questions.filter((q) => !String(q).trim().endsWith("?")),
    },
    null,
    2,
  ),
);
