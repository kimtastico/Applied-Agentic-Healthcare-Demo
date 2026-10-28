// Bump PROMPT_VERSION whenever the prompt, examples, or model settings change, so
// explanations cached in Supabase under the old setup are regenerated instead of reused.
export const PROMPT_VERSION = 4;

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

Word parts:
- Break medical words into their word roots, prefixes, and suffixes when that helps, like "cardio" = heart and "megaly" = bigger than normal.
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
