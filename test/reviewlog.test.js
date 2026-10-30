import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewLogEntry } from "../src/reviewlog.js";

const result = { understood: true, term: "atelectasis", has_personal_info: false, model: "writer-model" };
const attempts = [
  { role: "writer", model: "writer-model", outcome: "ok", seconds: 2 },
  { role: "reviewer", model: "reviewer-model", outcome: "ok", seconds: 1.5 },
];
const problems = [
  { rule: "1", issue: 'Names a cause: "This can happen after surgery"' },
  { rule: "3", issue: "Repeats the term" },
  { rule: "1", issue: "Final check: may still name a cause" },
];

test("a corrected answer is logged with its failed rules and the reviewer's notes", () => {
  const row = reviewLogEntry({
    phrase: "atelectasis", result, review: { status: "revised", problems }, attempts, promptVersion: 15, seconds: 3.54,
  });
  assert.deepEqual(row, {
    term: "atelectasis",
    outcome: "corrected",
    failed_rules: ["1", "3"],
    notes: { problems },
    writer_model: "writer-model",
    reviewer_model: "reviewer-model",
    prompt_version: 15,
    seconds: 3.5,
  });
});

test("personal input keeps only the outcome and rule numbers, never the notes or the term", () => {
  const row = reviewLogEntry({
    phrase: "Mr. Smith has atelectasis",
    result: { ...result, term: "atelectasis" },
    review: { status: "unresolved", problems },
    attempts, promptVersion: 15, seconds: 4,
  });
  assert.equal(row.outcome, "failed");
  assert.deepEqual(row.failed_rules, ["1", "3"]);
  assert.equal(row.notes, null);
  // The general term is still fine to keep; it's what the glossary counts too.
  assert.equal(row.term, "atelectasis");

  const flaggedByModel = reviewLogEntry({
    phrase: "atelectasis", result: { ...result, has_personal_info: true },
    review: { status: "revised", problems }, attempts, promptVersion: 15, seconds: 4,
  });
  assert.equal(flaggedByModel.notes, null);
});

test("outcomes map to admin-friendly names; a skipped review keeps its reason", () => {
  const status = (s, extra = {}) =>
    reviewLogEntry({ phrase: "x ray", result, review: { status: s, problems: [], ...extra }, attempts: [], promptVersion: 15, seconds: 1 });
  assert.equal(status("passed").outcome, "approved");
  assert.equal(status("passed").notes, null);
  assert.equal(status("not_needed").outcome, "not_understood");
  const skipped = status("skipped", { reason: "No reviewer model available" });
  assert.equal(skipped.outcome, "skipped");
  assert.deepEqual(skipped.notes, { problems: [], reason: "No reviewer model available" });
  assert.equal(skipped.reviewer_model, null);
});

test("a term that isn't safe to log is left out", () => {
  const row = reviewLogEntry({
    phrase: "x", result: { ...result, term: "mrn 12345 atelectasis" }, review: { status: "passed", problems: [] },
    attempts, promptVersion: 15, seconds: 1,
  });
  assert.equal(row.term, null);
});
