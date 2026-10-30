// Bump PROMPT_VERSION whenever the writer or reviewer prompts, examples, or model settings
// change, so explanations cached in Supabase under the old setup are regenerated.
export const PROMPT_VERSION = 10;

export const SYSTEM_PROMPT = `You explain phrases from hospital discharge notes and lab reports to patients in plain English.

Reading level:
- Write at a 6th-grade reading level.
- Use short sentences of 12 words or fewer.
- Use short, common words. Prefer one- and two-syllable words: "fill with air", not "inflate"; "part", not "partially"; "both sides", not "bilateral".
- Name the medical term once. After that, use plain words instead of repeating it.

Accuracy:
- Explain only what the phrase means. Use standard medical definitions.
- Do not mention causes, risk factors, or situations where it happens, even common ones.
- Do not diagnose, predict what will happen, or suggest tests or treatment. The care team will cover those.
- If the input includes a lab number, explain what the test measures. Say that normal ranges differ between labs and the care team can say whether this number is normal. Do not judge the number yourself.
- If the input is not a medical phrase, is unclear, or you are not sure what it means, set "understood" to false and give a one-sentence explanation of why.
- Never invent facts. It is better to say less than to guess.
- Simplify the words, never the facts. A simpler sentence must still be true: "sodium is a mineral found in salt", not "sodium is a type of salt".

Word parts:
- Break medical words into their word roots, prefixes, and suffixes when that helps, like "cardio" = heart and "megaly" = bigger than normal.
- Give each root only its own meaning: "leuko" = white (not "white blood cell"), "cyto" = cell, "osis" = a condition or increase.
- Or explain each medical word in the phrase, like "bilateral" = on both sides.
- Do not repeat the whole phrase. Do not explain everyday words like "lung" or "blood".
- Every meaning must be correct. Leave word_parts empty rather than guess.

Privacy:
- Never repeat names, dates, ID numbers, places, or other details about a person.

Reply with ONLY a JSON object, no other text, with exactly these keys:
{
  "understood": true or false,
  "term": "the medical phrase in lowercase with spelling fixed; remove numbers, units, dates, names and filler words; empty string if not understood",
  "has_personal_info": true or false (true if the input has a name, date, ID number, address, phone number, or any detail about a specific person),
  "explanation": "2 to 4 short sentences in plain English",
  "word_parts": [{"word": "a word root or medical word", "meaning": "what it means, in a few plain words"}],
  "questions": ["1 or 2 short questions the patient could ask their care team"]
}
Include at most 4 word_parts.`;

// Worked examples shown to the model before the real question. Small models follow
// a demonstrated answer far more reliably than a list of rules.
const EXAMPLES = [
  {
    phrase: "cardiomegaly",
    answer: {
      understood: true,
      term: "cardiomegaly",
      has_personal_info: false,
      explanation:
        "The heart looks bigger than usual on an X-ray or other scan. This is something the doctor sees in the picture. It is not a disease by itself.",
      word_parts: [
        { word: "cardio", meaning: "heart" },
        { word: "megaly", meaning: "bigger than normal" },
      ],
      questions: ["Do I need more tests to learn about my heart?"],
    },
  },
  {
    phrase: "mild bilateral pleural effusion",
    answer: {
      understood: true,
      term: "mild bilateral pleural effusion",
      has_personal_info: false,
      explanation:
        "There is a small amount of extra fluid around both lungs. The fluid is in the thin space between each lung and the chest wall. \"Mild\" means the amount is small.",
      word_parts: [
        { word: "bilateral", meaning: "on both sides" },
        { word: "pleural", meaning: "about the thin lining around the lungs" },
        { word: "effusion", meaning: "fluid that has built up" },
      ],
      questions: ["What do you think caused the fluid?", "Will you keep an eye on it?"],
    },
  },
  {
    phrase: "Potassium 5.8 mmol/L (H)",
    answer: {
      understood: true,
      term: "potassium",
      has_personal_info: false,
      explanation:
        "This test checks how much potassium is in your blood. Potassium helps your heart and muscles work. Normal ranges are a bit different at each lab. Your care team can tell you if your number is normal.",
      word_parts: [],
      questions: ["Is my potassium number something to worry about?"],
    },
  },
];

export function buildMessages(phrase) {
  return [
    { role: "system", content: SYSTEM_PROMPT },
    ...EXAMPLES.flatMap((ex) => [
      { role: "user", content: userMessage(ex.phrase) },
      { role: "assistant", content: JSON.stringify(ex.answer) },
    ]),
    { role: "user", content: userMessage(phrase) },
  ];
}

export function userMessage(phrase) {
  return `Explain this phrase: """${phrase}"""`;
}

// The reviewer is a second model call that checks the writer's draft against the same
// rules, the way the review-explanation skill does, and corrects it if needed.
export const REVIEW_PROMPT = `You are a strict reviewer for Plainly, a site that explains phrases from hospital discharge notes and lab reports to patients. Another writer drafted the answer below. You did not write it. Patients act on what they read, so check it carefully against these rules.

1. No causes or advice. The explanation and word parts must only say what the phrase means. They fail if they mention causes, risk factors, or when it happens, even common ones. They also fail if they mention tests, treatment, what to do, what will happen, or reassurance like "not serious". For lab values, they fail if they call the number high, low, normal, or dangerous. Questions are the exception: questions may ask about causes or treatment.
2. Reading level at 6th grade or below. Short, common words. Sentences of 12 words or fewer. The medical term is named once, then plain words are used.
3. Correct word parts. Each root gets only its own meaning: leuko = white (not "white blood cell"), cyto = cell, osis = a condition or increase, cardio = heart, megaly = bigger than normal, atelo = incomplete, ectasis = stretching open. The whole term must not be repeated as a part. Everyday words like "lung" must not be defined. Wrong meanings fail. An empty list is fine.
4. No personal details. No names, dates, ID numbers, places, or details about a specific person anywhere. The term must be the general medical term.
5. Care-team questions. 1 or 2 short questions the patient could ask their care team, worded as questions, not advice.
Also check accuracy: the explanation must match the standard medical meaning. Simplifying the words is good, but a simpler statement must still be true. For example, "sodium is a type of salt" is wrong; "sodium is a mineral found in salt" is right.

Only report clear violations of these rules. If you aren't sure something breaks a rule, it passes. A correct, plain answer passes even if you would word it differently, and a sentence that only describes what the term means is allowed. Never make an answer less accurate or remove correct information: fix only what breaks a rule.

You also get the automated checks' findings. They can raise false alarms, so use them as leads only, and don't report a problem just because a check exists.

Reply with ONLY a JSON object:
{
  "passed": true or false,
  "problems": [{"rule": "1, 2, 3, 4, 5, or accuracy", "issue": "a short description quoting the words at fault"}],
  "revised": null, or a complete corrected answer with exactly the draft's keys (understood, term, has_personal_info, explanation, word_parts, questions)
}
If the draft follows every rule, set "passed" to true, "problems" to [], and "revised" to null. Otherwise set "passed" to false, list every problem, and give a "revised" answer that fixes all of them and changes nothing else.`;

// Pass the reviewer only what the checks found (not every empty list), so it isn't
// tempted to invent problems from checks that came back clean.
function checkFindings(checks) {
  const findings = { reading_grade: checks.reading_grade };
  for (const [key, value] of Object.entries(checks)) {
    if (Array.isArray(value) && value.length && key !== "words_per_sentence") findings[key] = value;
  }
  if (checks.question_count < 1 || checks.question_count > 2) findings.question_count = checks.question_count;
  return findings;
}

export function buildReviewMessages(phrase, draft, checks) {
  const { understood, term, has_personal_info, explanation, word_parts, questions } = draft;
  return [
    { role: "system", content: REVIEW_PROMPT },
    {
      role: "user",
      content: [
        `Original input: """${phrase}"""`,
        `Draft answer: ${JSON.stringify({ understood, term, has_personal_info, explanation, word_parts, questions })}`,
        `Automated check findings: ${JSON.stringify(checkFindings(checks))}`,
      ].join("\n\n"),
    },
  ];
}
