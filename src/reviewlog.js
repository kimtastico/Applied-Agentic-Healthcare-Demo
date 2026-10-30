import { isLoggableTerm, looksPersonal } from "./lib.js";

// Pipeline review statuses → the outcomes admins see in the review_log table.
const OUTCOMES = {
  passed: "approved",
  revised: "corrected",
  unresolved: "failed",
  skipped: "skipped",
  not_needed: "not_understood",
};

/**
 * One row for the private review_log table, so admins can assess the models.
 * Privacy guard: if the input or the answer looks personal, only the outcome and the
 * rule numbers are kept — never the reviewer's notes, which can quote the draft.
 */
export function reviewLogEntry({ phrase, result, review, attempts = [], promptVersion, seconds }) {
  const personal = looksPersonal(phrase) || result.has_personal_info === true;
  const term = isLoggableTerm(result.term) ? result.term : null;
  const problems = review.problems ?? [];
  const failedRules = [...new Set(problems.map((p) => String(p.rule ?? "").trim()).filter(Boolean))];
  const hasNotes = problems.length > 0 || Boolean(review.reason);
  const reviewer = attempts.filter((a) => a.role === "reviewer" && a.outcome === "ok").at(-1);

  return {
    term,
    outcome: OUTCOMES[review.status] ?? "skipped",
    failed_rules: failedRules,
    notes: personal || !hasNotes ? null : { problems, ...(review.reason && { reason: review.reason }) },
    writer_model: result.model ?? null,
    reviewer_model: reviewer?.model ?? null,
    prompt_version: promptVersion,
    seconds: Math.round(seconds * 10) / 10,
  };
}
