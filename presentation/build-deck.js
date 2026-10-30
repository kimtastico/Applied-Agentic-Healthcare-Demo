// Builds plainly-deck.pptx: the 7-slide class presentation for Plainly.
// Run: cd presentation && npm install && npm run build
//
// Style rules (from the course's slide instructions): Arial; titles 40pt bold, all other
// text 32pt (the title slide's headline is the one exception); at most three colors per
// slide; no decoration; the logo motif appears on the title slide only. Sources for each
// slide are in its speaker notes.

const path = require("path");
const pptxgen = require("pptxgenjs");
const { applyTheme } = require("./apply-theme.js");

const THEME = {
  name: "Plainly",
  headFontFace: "Arial",
  bodyFontFace: "Arial",
  colors: {
    dk1: "1B2421", // main text
    lt1: "F7F8F6", // background
    dk2: "4F5B57", // secondary text
    lt2: "DDE3E0", // faint lines
    accent1: "0F6B5C", // Plainly teal (the accent)
    accent2: "B4532A", // supporting accent: only for a real opposite (stored vs never stored)
    accent3: "4F5B57",
    accent4: "DDE3E0",
    accent5: "0F6B5C",
    accent6: "B4532A",
    hlink: "0F6B5C",
    folHlink: "0F6B5C",
  },
};

const TITLE_PT = 40;
const BODY_PT = 32;
const MONO = "Courier New"; // only for code identifiers (database column names)
const SITE_URL = "https://plainly-medical-explainer.kimtastico.workers.dev";

const pres = new pptxgen();
pres.layout = "LAYOUT_WIDE"; // 13.333" × 7.5"
pres.title = "Plainly: medical words, explained";
pres.theme = { headFontFace: THEME.headFontFace, bodyFontFace: THEME.bodyFontFace };
const C = pres.SchemeColor;
const HEX = THEME.colors; // for hex-only options (lines, borders)

const M = 0.6; // side margin
const W = 13.333 - 2 * M; // content width

// --- Layouts ----------------------------------------------------------------------

pres.defineSlideMaster({
  title: "Title",
  background: { color: C.background1 },
  objects: [
    {
      placeholder: {
        options: {
          name: "title", type: "title", x: 4.0, y: 2.05, w: 8.7, h: 3.4,
          fontSize: 54, bold: true, color: C.text1, valign: "middle", margin: 0,
        },
        text: "",
      },
    },
  ],
});

pres.defineSlideMaster({
  title: "Title only",
  background: { color: C.background1 },
  objects: [
    {
      placeholder: {
        options: {
          name: "title", type: "title", x: M, y: 0.45, w: W, h: 0.8,
          fontSize: TITLE_PT, bold: true, color: C.text1, valign: "middle", margin: 0,
        },
        text: "",
      },
    },
  ],
});

// --- Building blocks --------------------------------------------------------------

const body = (extra = {}) => ({ fontSize: BODY_PT, color: C.text1, isTextBox: true, margin: 0, ...extra });

// A flow-diagram step: a rounded box with centered 32pt text. `outcome` fills it with
// the accent: on every slide, only the result the visitor sees is colored.
function step(slide, name, x, y, w, h, text, { outcome = false } = {}) {
  slide.addText(text, {
    shape: pres.ShapeType.roundRect, rectRadius: 0.12, x, y, w, h,
    fill: { color: outcome ? C.accent1 : C.background1 },
    line: { color: outcome ? HEX.accent1 : HEX.dk2, width: 1.5 },
    fontSize: BODY_PT, color: outcome ? C.background1 : C.text1,
    align: "center", valign: "middle", margin: 0.08, objectName: name,
  });
}

// A decision: who decides, drawn the same way wherever it appears.
function decision(slide, name, x, y, w, h, text) {
  slide.addText(text, {
    shape: pres.ShapeType.diamond, x, y, w, h,
    fill: { color: C.background1 }, line: { color: HEX.dk2, width: 1.5 },
    fontSize: BODY_PT, color: C.text1, align: "center", valign: "middle", margin: 0, objectName: name,
  });
}

// Arrows are always the main text color with a triangle head.
function arrow(slide, name, x1, y1, x2, y2) {
  slide.addShape(pres.ShapeType.line, {
    x: Math.min(x1, x2), y: Math.min(y1, y2),
    w: Math.abs(x2 - x1) || 0.0001, h: Math.abs(y2 - y1) || 0.0001,
    flipH: x2 < x1, flipV: y2 < y1,
    line: { color: HEX.dk1, width: 3, endArrowType: "triangle" },
    objectName: name,
  });
}

function label(slide, name, x, y, w, text) {
  slide.addText(text, { ...body(), x, y, w, h: 0.55, objectName: name });
}

// --- Slide 1: title ------------------------------------------------------------------

{
  const s = pres.addSlide({ masterName: "Title" });
  // Motif (title slide only): Plainly's logo mark, a white cross on a teal rounded square.
  s.addShape(pres.ShapeType.roundRect, {
    x: 0.9, y: 2.55, w: 2.4, h: 2.4, rectRadius: 0.45, fill: { color: C.accent1 }, line: { type: "none" },
    objectName: "Logo square",
  });
  s.addShape(pres.ShapeType.plus, {
    x: 1.35, y: 3.0, w: 1.5, h: 1.5, fill: { color: C.background1 }, line: { type: "none" },
    objectName: "Logo cross",
  });
  s.addText([{ text: "Plainly:", options: { breakLine: true } }, { text: "medical words, explained" }], {
    placeholder: "title",
  });
  s.addNotes(
    "Plainly turns phrases from discharge notes and lab reports into plain English.\n\n" +
      "Live site: " + SITE_URL + "\n" +
      "Code: https://github.com/kimtastico/Applied-Agentic-Healthcare-Demo",
  );
}

// --- Slide 2: why and what -----------------------------------------------------------

{
  const s = pres.addSlide({ masterName: "Title only" });
  s.addText("Your reports should make sense to you", { placeholder: "title" });

  const colW = (W - 0.5) / 2;
  const left = M;
  const right = M + colW + 0.5;

  s.addText(
    [
      { text: "Why it matters to me", options: { bold: true, breakLine: true } },
      { text: "[Your reason, in your own words: 1–2 sentences]", options: { color: C.text2, italic: true } },
    ],
    { ...body(), x: left, y: 1.6, w: colW, h: 3.0, valign: "top", paraSpaceAfter: 12, objectName: "Why" },
  );

  const goals = [
    "Paste a phrase like “hyponatremia”",
    "Plain English, grade 6",
    "Temperature 0: creativity is a bug",
    "Save the term, never the person",
  ];
  s.addText(
    [
      { text: "The goal", options: { bold: true, breakLine: true } },
      ...goals.map((g, i) => ({
        text: g,
        options: { bullet: { indent: 30 }, breakLine: i < goals.length - 1 },
      })),
    ],
    { ...body(), x: right, y: 1.6, w: colW, h: 5.2, valign: "top", paraSpaceAfter: 10, objectName: "Goal" },
  );
  s.addNotes(
    "Why: [say your personal reason here, in your own words].\n\n" +
      "Goal, from my project brief: paste a phrase from a discharge note or lab report, like “mild bilateral " +
      "pleural effusion,” and get a plain-English explanation at a 6th-grade reading level. Supabase logs only " +
      "the term, not the user, building a public glossary of the most-searched phrases. Temperature 0: " +
      "“Creativity is a bug for these tasks.”\n\n" +
      "Running example for the whole deck: hyponatremia (low sodium in the blood).\n\n" +
      "Source: my project brief.",
  );
}

// --- Slide 3: how it works, part 1 -----------------------------------------------------

{
  const s = pres.addSlide({ masterName: "Title only" });
  s.addText("The glossary is checked before any AI", { placeholder: "title" });

  const rowY = 2.0, rowH = 1.9, midY = rowY + rowH / 2;
  step(s, "Paste", M, rowY, 3.2, rowH, "You paste “hyponatremia”");
  arrow(s, "Arrow paste to worker", M + 3.2, midY, M + 3.85, midY);
  step(s, "Worker", M + 3.85, rowY, 3.3, rowH, "Worker looks in the glossary");
  arrow(s, "Arrow worker to decision", M + 7.15, midY, M + 7.8, midY);
  decision(s, "Saved before?", M + 7.8, rowY - 0.1, 3.4, rowH + 0.2, "Saved?");

  // Yes: the saved answer is shown immediately (the outcome, in the accent).
  const decCx = M + 7.8 + 1.7;
  arrow(s, "Arrow yes", decCx, rowY + rowH + 0.1, decCx, 4.95);
  label(s, "Yes label", decCx + 0.15, 4.2, 1.0, "Yes");
  step(s, "Instant answer", decCx - 1.9, 4.95, 3.8, 1.55, "Show saved answer: instant", { outcome: true });

  // No: the flow runs off the right edge and continues on the next slide.
  arrow(s, "Arrow no, continues on next slide", M + 11.2, midY, 13.333, midY);
  label(s, "No label", M + 11.3, midY - 0.65, 1.0, "No");
  s.addNotes(
    "1. The visitor pastes a phrase, here “hyponatremia.”\n" +
      "2. The Cloudflare Worker (the site’s server code) looks the term up in the Supabase glossary.\n" +
      "3. The Worker decides: if this exact term was already answered and reviewed under the current " +
      "instructions, it shows that saved answer instantly, with no AI call. Otherwise the flow continues on " +
      "the next slide.\n\n" +
      "Source: project code, src/worker.js (handleExplain) and README “How it works.”",
  );
}

// --- Slide 4: how it works, part 2 -----------------------------------------------------

{
  const s = pres.addSlide({ masterName: "Title only" });
  s.addText("A second AI checks every new answer", { placeholder: "title" });

  const r1 = 1.75, h1 = 2.3, mid1 = r1 + h1 / 2;
  const bx = [1.0, 4.85, 8.7], bw = [3.35, 3.35, 3.73];
  const lines = (...ls) => ls.map((t, i) => ({ text: t, options: { breakLine: i < ls.length - 1 } }));

  // The flow comes in from the left edge, continuing from the previous slide.
  arrow(s, "Arrow in from previous slide", 0, mid1, bx[0], mid1);
  step(s, "Writer", bx[0], r1, bw[0], h1, lines("Writer AI drafts", "(Llama 3.3 70B)"));
  arrow(s, "Arrow writer to checks", bx[0] + bw[0], mid1, bx[1], mid1);
  step(s, "Code checks", bx[1], r1, bw[1], h1, lines("Code checks:", "grade, causes,", "privacy"));
  arrow(s, "Arrow checks to reviewer", bx[1] + bw[1], mid1, bx[2], mid1);
  step(s, "Reviewer", bx[2], r1, bw[2], h1, lines("Reviewer AI", "approves or fixes", "(gpt-oss-120b)"));

  const r2 = 4.75, h2 = 1.7, mid2 = r2 + h2 / 2;
  const revCx = bx[2] + bw[2] / 2;
  arrow(s, "Arrow reviewer to save", revCx, r1 + h1, revCx, r2);
  step(s, "Save", bx[2], r2, bw[2], h2, "Saved to the glossary");
  arrow(s, "Arrow save to answer", bx[2], mid2, bx[1] + bw[1], mid2);
  step(s, "Answer", bx[1], r2, bw[1], h2, "Answer with review badge", { outcome: true });
  s.addNotes(
    "4. The writer AI (Llama 3.3 70B on Cloudflare Workers AI) drafts the explanation at temperature 0, " +
      "following worked examples.\n" +
      "5. Code checks what a computer can: reading grade, phrases that sound like causes or advice, " +
      "personal details.\n" +
      "6. The reviewer AI (gpt-oss-120b) checks the draft against the five rules — no causes or advice, " +
      "grade 6 or below, correct word roots, no personal details, care-team questions — and approves it or " +
      "returns a corrected version.\n" +
      "7. Only approved or corrected answers are saved, so the next search for the term is instant.\n" +
      "8. The visitor sees the answer with a badge: “Checked by reviewer AI” or “Corrected by reviewer AI.”\n\n" +
      "If the reviewer is unavailable, the answer is still shown, marked “Not yet reviewed,” and isn’t saved.\n\n" +
      "Source: project code, src/pipeline.js and src/models.js; README “How it works.”",
  );
}

// --- Slide 5: models -------------------------------------------------------------------

{
  const s = pres.addSlide({ masterName: "Title only" });
  s.addText("A different model checks the writer", { placeholder: "title" });

  const cell = (text, extra = {}) => ({ text, options: { fontSize: BODY_PT, color: C.text1, ...extra } });
  const head = (text) => cell(text, { bold: true });
  const rows = [
    [cell(""), head("Writer"), head("Reviewer")],
    [cell("Model", { color: C.text2 }), cell("Llama 3.3 70B"), cell("gpt-oss-120b")],
    [cell("Made by", { color: C.text2 }), cell("Meta", { color: C.accent1, bold: true }), cell("OpenAI", { color: C.accent1, bold: true })],
    [cell("Runs on", { color: C.text2 }), cell("Cloudflare Workers AI"), cell("Cloudflare Workers AI")],
    [cell("Why", { color: C.text2 }), cell("Clear, fast writing"), cell("Reasons through rules")],
  ];
  s.addTable(rows, {
    x: M, y: 1.55, w: W, colW: [2.5, 4.8, 4.83],
    border: { type: "solid", pt: 1, color: HEX.lt2 },
    fill: { color: C.background1 }, margin: [0.06, 0.12, 0.06, 0.12], valign: "middle",
    objectName: "Writer vs reviewer",
  });
  s.addText("Backup if Workers AI fails: NVIDIA Nemotron", {
    ...body(), x: M, y: 4.95, w: W, h: 0.6, objectName: "Backups",
  });
  s.addNotes(
    "Both models are open-weight: their makers publish them, and Cloudflare runs its own copies, so there is " +
      "no OpenAI or Meta account and no cost beyond Cloudflare’s free daily Workers AI allowance.\n\n" +
      "Why two different makers: a reviewer from a different model family is less likely to share the writer’s " +
      "blind spots, and models tend to rate their own writing too kindly. (This is our design reasoning, based on " +
      "general research on AI models judging AI output; we did not run a controlled test of it.)\n\n" +
      "Writer: Llama 3.3 70B — clear plain writing, follows a fixed answer format, fast. Reviewer: gpt-oss-120b — " +
      "larger, and a reasoning model that thinks through the rules before giving a verdict (set to low effort to " +
      "stay quick). Both run at temperature 0.\n\n" +
      "Backups: NVIDIA’s free Nemotron 3 Ultra and Nemotron 3.5 Lightning. We started on NVIDIA, but its free " +
      "trial was often overloaded and retired our first model, Llama 3.3, so the same Llama now runs on Cloudflare.\n\n" +
      "Sources: Cloudflare Workers AI model catalog (developers.cloudflare.com/workers-ai/models), read through " +
      "Wrangler 4.154’s built-in Workers AI model definitions; NVIDIA API catalog (build.nvidia.com); project " +
      "settings in wrangler.jsonc.",
  );
}

// --- Slide 6: database ---------------------------------------------------------------

{
  const s = pres.addSlide({ masterName: "Title only" });
  s.addText("The database: one row per term", { placeholder: "title" });

  s.addText(
    [{ text: "Supabase table: " }, { text: "glossary_terms", options: { fontFace: MONO } }],
    { ...body(), x: M, y: 1.45, w: W, h: 0.55, objectName: "Table name" },
  );

  // Database columns run down the left; each sample is one row of the table.
  const field = (text) => ({ text, options: { fontSize: BODY_PT, fontFace: MONO, color: C.text1 } });
  const val = (text, extra = {}) => ({ text, options: { fontSize: BODY_PT, color: C.text1, ...extra } });
  const head = (text) => ({ text, options: { fontSize: BODY_PT, color: C.text2, bold: true } });
  const rows = [
    [head("column"), head("row 1"), head("row 2")],
    [field("term"), val("hyponatremia", { bold: true }), val("potassium", { bold: true })],
    [field("search_count"), val("3 (example)"), val("1 (example)")],
    [
      field("explanation"),
      {
        text: [
          { text: "“Less sodium in your blood…”", options: { color: C.text1, breakLine: true } },
          { text: "Reviewed by AI", options: { color: C.accent1, bold: true } },
        ],
        options: { fontSize: BODY_PT },
      },
      val("None: the input had a number"),
    ],
    [field("model"), val("Llama 3.3 70B"), val("None")],
  ];
  s.addTable(rows, {
    x: M, y: 2.15, w: W, colW: [3.5, 4.4, 4.23],
    border: { type: "solid", pt: 1, color: HEX.lt2 },
    fill: { color: C.background1 }, margin: [0.06, 0.12, 0.06, 0.12], valign: "middle",
    objectName: "Sample rows",
  });
  s.addText(
    [
      { text: "Never stored: ", options: { bold: true, color: C.accent2 } },
      { text: "who searched or what they typed" },
    ],
    { ...body(), x: M, y: 6.5, w: W, h: 0.55, objectName: "Never stored" },
  );
  s.addNotes(
    "The whole database is one Supabase table, glossary_terms. Each row is one medical term: term, search_count, explanation " +
      "(the reviewed answer plus what the reviewer found, as JSON), model (which AI wrote it, e.g. " +
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast), prompt_version (old answers are redone when the " +
      "instructions change), and two timestamps.\n\n" +
      "Row 1: a real answer from the live site (hyponatremia, reviewed by gpt-oss-120b).\n" +
      "Row 2: what happens with “potassium 5.8 mmol/L”: the answer may mention that number, so only the term " +
      "is counted and no explanation is saved.\n" +
      "The search counts shown are examples, not live numbers.\n\n" +
      "Privacy: anyone can read the glossary, but only the server can write to it (row-level security), and " +
      "there is no column for a user, their IP address, or the text someone typed.\n\n" +
      "Source: project code, supabase/migrations/0001_glossary.sql and src/worker.js.",
  );
}

// --- Slide 7: demo ---------------------------------------------------------------------

{
  const s = pres.addSlide({ masterName: "Title only" });
  s.addText("Try it: a reviewed answer in seconds", { placeholder: "title" });

  const imgW = 6.8, imgH = imgW / (742 / 443);
  s.addImage({
    path: path.join(__dirname, "assets", "demo-hyponatremia.png"),
    x: M, y: 1.55, w: imgW, h: imgH,
    altText: "Plainly’s answer for hyponatremia, with the badges Written by AI, Reading level about grade 3, Checked by reviewer AI, and Counted in public glossary",
    objectName: "Demo screenshot",
  });

  const steps = [
    "Search “hyponatremia”",
    "Search it again: instant",
    "Try “potassium 5.8\u00A0mmol/L”",
    "Check /api/health/ai",
  ];
  s.addText(
    steps.map((t, i) => ({
      text: t,
      options: { bullet: { type: "number", indent: 36 }, breakLine: i < steps.length - 1 },
    })),
    { ...body(), x: M + imgW + 0.45, y: 1.55, w: W - imgW - 0.45, h: 4.4, valign: "top", paraSpaceAfter: 14, objectName: "Demo steps" },
  );
  s.addText(
    [{ text: SITE_URL.replace("https://", ""), options: { hyperlink: { url: SITE_URL, tooltip: "Open Plainly" }, color: C.accent1, underline: { style: "sng" } } }],
    { ...body(), x: M, y: 6.3, w: W, h: 0.6, objectName: "Live site link" },
  );
  s.addNotes(
    "Live: " + SITE_URL + "\n\n" +
      "1. Search “hyponatremia”: the writer drafts, the reviewer checks, about 5 seconds. Point out the badges.\n" +
      "2. Search it again: instant, “From the glossary,” word for word the same.\n" +
      "3. Try “potassium 5.8 mmol/L”: it explains what the test measures, doesn’t judge the number, and only " +
      "“potassium” is counted.\n" +
      "4. Open " + SITE_URL + "/api/health/ai: it shows which models answered and how long each took.\n\n" +
      "Before presenting, search each demo term once so it’s saved and instant.\n\n" +
      "Screenshot: the live site’s hyponatremia answer, October 30, 2026.\n\n" +
      "References: project repository, https://github.com/kimtastico/Applied-Agentic-Healthcare-Demo; " +
      "Cloudflare Workers AI models, https://developers.cloudflare.com/workers-ai/models/; " +
      "NVIDIA API catalog, https://build.nvidia.com; Supabase, https://supabase.com.",
  );
}

// --- Write ---------------------------------------------------------------------------

(async () => {
  const out = path.join(__dirname, "plainly-deck.pptx");
  await pres.writeFile({ fileName: out });
  await applyTheme(out, THEME);
  console.log("Wrote", out);
})();
