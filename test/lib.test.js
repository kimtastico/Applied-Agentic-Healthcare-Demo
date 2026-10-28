import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractJson,
  fleschKincaidGrade,
  isLoggableTerm,
  looksPersonal,
  normalizePhrase,
  sanitizeExplanation,
} from "../src/lib.js";

test("normalizePhrase lowercases, collapses spaces, trims punctuation", () => {
  assert.equal(normalizePhrase("  Mild   Bilateral Pleural Effusion. "), "mild bilateral pleural effusion");
  assert.equal(normalizePhrase('"Cardiomegaly"'), "cardiomegaly");
});

test("looksPersonal flags identifiers but not ordinary terms", () => {
  for (const s of [
    "John's MRN 4482913",
    "seen on 03/14/2025",
    "Mr. Smith has effusion",
    "call 555-123-4567",
    "patient has cardiomegaly",
    "DOB march 3",
  ]) {
    assert.ok(looksPersonal(s), s);
  }
  for (const s of ["mild bilateral pleural effusion", "pt/inr", "nail bed infection", "vitamin b12 deficiency", "hba1c"]) {
    assert.ok(!looksPersonal(s), s);
  }
});

test("isLoggableTerm accepts short general terms only", () => {
  assert.ok(isLoggableTerm("mild bilateral pleural effusion"));
  assert.ok(isLoggableTerm("covid-19"));
  assert.ok(!isLoggableTerm("x"));
  assert.ok(!isLoggableTerm("Cardiomegaly")); // must already be normalized
  assert.ok(!isLoggableTerm("one two three four five six seven eight nine"));
  assert.ok(!isLoggableTerm("effusion <script>"));
  assert.ok(!isLoggableTerm("mrn 12345"));
  assert.ok(!isLoggableTerm(null));
});

test("extractJson handles fences and surrounding text", () => {
  assert.deepEqual(extractJson('```json\n{"a": 1}\n```'), { a: 1 });
  assert.deepEqual(extractJson('Sure! {"a": {"b": 2}} Hope that helps.'), { a: { b: 2 } });
  assert.equal(extractJson("no json here"), null);
  assert.equal(extractJson("{broken"), null);
});

test("sanitizeExplanation enforces shape and drops extras when not understood", () => {
  const ok = sanitizeExplanation({
    understood: true,
    term: "  Cardiomegaly ",
    explanation: "The heart looks bigger than usual.",
    word_parts: [{ word: "cardio", meaning: "heart" }, { word: "" }, "junk"],
    questions: ["Why?", 7, ""],
    extra: "ignored",
  });
  assert.deepEqual(ok, {
    understood: true,
    term: "cardiomegaly",
    has_personal_info: false,
    explanation: "The heart looks bigger than usual.",
    word_parts: [{ word: "cardio", meaning: "heart" }],
    questions: ["Why?"],
  });

  const unclear = sanitizeExplanation({ understood: false, explanation: "Not a medical phrase.", questions: ["x"] });
  assert.equal(unclear.understood, false);
  assert.deepEqual(unclear.questions, []);

  assert.equal(sanitizeExplanation({ understood: true, explanation: "" }).understood, false);
  assert.equal(sanitizeExplanation(null), null);
});

test("fleschKincaidGrade rates simple text low and jargon high", () => {
  const simple = fleschKincaidGrade("There is a small amount of extra fluid around both lungs. The amount is small.");
  const jargon = fleschKincaidGrade(
    "Radiographic evaluation demonstrates bilateral pleural effusions with associated compressive atelectasis.",
  );
  assert.ok(simple < 6, `simple=${simple}`);
  assert.ok(jargon > 12, `jargon=${jargon}`);
  assert.equal(fleschKincaidGrade(""), null);
});
