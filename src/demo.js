// Fixed answers used only when NVIDIA_API_KEY is not set, so the site can be
// previewed and deployed before the AI is connected.

export const DEMO_EXPLANATIONS = {
  "mild bilateral pleural effusion": {
    understood: true,
    term: "mild bilateral pleural effusion",
    has_personal_info: false,
    explanation:
      "There is a small amount of extra fluid around both lungs. The fluid sits in the thin space between each lung and the chest wall. \"Mild\" means the amount is small.",
    word_parts: [
      { word: "mild", meaning: "small, not severe" },
      { word: "bilateral", meaning: "on both sides" },
      { word: "pleural", meaning: "about the thin lining around the lungs" },
      { word: "effusion", meaning: "fluid that has built up" },
    ],
    questions: ["What do you think caused the fluid?", "Does it need treatment, or will you keep an eye on it?"],
  },
  cardiomegaly: {
    understood: true,
    term: "cardiomegaly",
    has_personal_info: false,
    explanation:
      "The heart looks bigger than usual on an X-ray or scan. This is a sign, not a disease by itself. Many different things can cause it.",
    word_parts: [
      { word: "cardio", meaning: "heart" },
      { word: "megaly", meaning: "larger than normal" },
    ],
    questions: ["Do I need more tests to learn why my heart looks bigger?"],
  },
  leukocytosis: {
    understood: true,
    term: "leukocytosis",
    has_personal_info: false,
    explanation:
      "Your blood has more white blood cells than usual. White blood cells help your body fight germs. The count can go up for many reasons, such as an infection or stress on the body.",
    word_parts: [
      { word: "leuko", meaning: "white" },
      { word: "cyto", meaning: "cell" },
      { word: "osis", meaning: "a condition or increase" },
    ],
    questions: ["What do you think made my white blood cell count go up?", "Should this test be checked again?"],
  },
};
