// Pure helpers with no network access, so they can be unit tested in Node.

export const MAX_INPUT_CHARS = 300;
export const MAX_TERM_CHARS = 80;
export const MAX_TERM_WORDS = 8;

/** Lowercase, collapse whitespace, trim surrounding punctuation. Used as the glossary key. */
export function normalizePhrase(text) {
  return String(text ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/^[\s"'“”‘’.,;:!?-]+|[\s"'“”‘’.,;:!?-]+$/g, "")
    .trim();
}

// Patterns that suggest the text is about a specific person rather than a general term.
const PERSONAL_INFO_PATTERNS = [
  /[\w.+-]+@[\w-]+\.[\w.]+/, // email
  /\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/, // phone number
  /\b\d{1,4}[/-]\d{1,2}[/-]\d{1,4}\b/, // numeric date
  /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+\d{1,2}\b/i, // "March 3"
  /\d{3,}/, // any run of 3+ digits: IDs, MRNs, years, room numbers
  /\b(mrn|dob|ssn|d\.o\.b|date of birth|medical record|acct)\b/i,
  /\b(mr|mrs|ms|miss|dr)\.?\s+[a-z]/i, // honorific + name
  /\b(patient|he|she|his|her|him|their)\b/i, // narrative about a person
];

export function looksPersonal(text) {
  return PERSONAL_INFO_PATTERNS.some((re) => re.test(text));
}

/**
 * Decide whether a model-produced term is safe to add to the public glossary.
 * We only ever store the short, general medical term — never the user's raw text.
 */
export function isLoggableTerm(term) {
  if (typeof term !== "string") return false;
  const t = term.trim();
  if (t.length < 2 || t.length > MAX_TERM_CHARS) return false;
  if (t.split(/\s+/).length > MAX_TERM_WORDS) return false;
  if (!/^[a-z0-9][a-z0-9 ,'()\/+-]*$/.test(t)) return false;
  return !looksPersonal(t);
}

/**
 * Pull the first JSON object out of a model reply. Handles ```json fences,
 * stray text before or after the object, and <think>...</think> blocks
 * that reasoning models emit before their answer.
 */
export function extractJson(text) {
  if (typeof text !== "string") return null;
  text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*<\/think>/i, "");
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
}

const str = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** Coerce a parsed model reply into the exact shape the frontend expects. */
export function sanitizeExplanation(raw) {
  if (!raw || typeof raw !== "object") return null;
  const explanation = str(raw.explanation, 1200);
  const understood = raw.understood === true && explanation.length > 0;
  const wordParts = Array.isArray(raw.word_parts)
    ? raw.word_parts
        .map((p) => ({ word: str(p?.word, 60), meaning: str(p?.meaning, 200) }))
        .filter((p) => p.word && p.meaning)
        .slice(0, 5)
    : [];
  const questions = Array.isArray(raw.questions)
    ? raw.questions.map((q) => str(q, 200)).filter(Boolean).slice(0, 3)
    : [];
  return {
    understood,
    term: normalizePhrase(str(raw.term, MAX_TERM_CHARS * 2)),
    has_personal_info: raw.has_personal_info === true,
    explanation,
    word_parts: understood ? wordParts : [],
    questions: understood ? questions : [],
  };
}

function countSyllables(word) {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w
    .replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "")
    .replace(/^y/, "")
    .match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

/**
 * Flesch–Kincaid grade level. A rough check that the output really is
 * around a 6th-grade level; shown to the user as an estimate.
 */
export function fleschKincaidGrade(text) {
  const sentences = String(text).split(/[.!?]+/).filter((s) => s.trim()).length;
  const words = String(text).match(/[A-Za-z]+(?:'[A-Za-z]+)?/g) || [];
  if (!sentences || !words.length) return null;
  const syllables = words.reduce((n, w) => n + countSyllables(w), 0);
  const grade = 0.39 * (words.length / sentences) + 11.8 * (syllables / words.length) - 15.59;
  return Math.max(0, Math.round(grade * 10) / 10);
}

// Phrases that usually mean a cause, advice, or prediction slipped into an explanation.
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
];

// Phrases that can judge a lab number ("your potassium is high"). They're only hints for the
// reviewer: in a definition ("hyperkalemia: potassium in the blood is too high") they're
// correct, and answers to inputs with a number are never saved anyway.
const NUMBER_JUDGMENT = [/\b(too high|too low|is normal|is high|is low|dangerous)\b/i];

const wordCount = (s) => (s.match(/[A-Za-z0-9'-]+/g) || []).length;

/**
 * Rule checks a computer can do: reading grade, sentence length, likely causes or advice,
 * personal details, a repeated term, question count. Shared by the website's reviewer
 * step and the review-explanation skill. Flags are leads, not verdicts.
 */
export function mechanicalChecks(answer) {
  const explanation = String(answer?.explanation ?? "");
  const term = normalizePhrase(answer?.term ?? "");
  const wordParts = Array.isArray(answer?.word_parts) ? answer.word_parts : [];
  const questions = Array.isArray(answer?.questions) ? answer.questions : [];
  const sentences = explanation.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter(Boolean);
  const grade = fleschKincaidGrade(explanation);

  return {
    reading_grade: grade,
    reading_grade_ok: grade == null ? null : grade <= 6,
    sentences: sentences.length,
    words_per_sentence: sentences.map(wordCount),
    sentences_over_12_words: sentences.filter((s) => wordCount(s) > 12),
    possible_cause_or_advice: CAUSE_OR_ADVICE.flatMap((re) => {
      const m = explanation.match(re);
      return m ? [m[0]] : [];
    }),
    possible_number_judgment: NUMBER_JUDGMENT.flatMap((re) => {
      const m = explanation.match(re);
      return m ? [m[0]] : [];
    }),
    possible_personal_details_in: [
      ["explanation", explanation],
      ["term", term],
      ...wordParts.map((p, i) => [`word_parts[${i}]`, `${p?.word ?? ""} ${p?.meaning ?? ""}`]),
    ].flatMap(([where, text]) => (looksPersonal(text) ? [where] : [])),
    word_parts_repeating_term: wordParts
      .filter((p) => term && normalizePhrase(p?.word ?? "") === term)
      .map((p) => p.word),
    question_count: questions.length,
    questions_not_ending_in_question_mark: questions.filter((q) => !String(q).trim().endsWith("?")),
  };
}
