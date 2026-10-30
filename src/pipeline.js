import { mechanicalChecks } from "./lib.js";
import { explainWithModel, reviewWithModel } from "./models.js";

// The whole answer (writer, plus reviewer if there's time) should arrive within this,
// so visitors aren't left waiting on a stalled free endpoint.
const DEFAULT_TOTAL_SECONDS = 55;
// Don't start a review that can't finish: below this, the draft is returned unreviewed.
const MIN_REVIEW_SECONDS = 10;
// The final check allows one grade above the rule's target of 6, because the formula
// counts the long medical term itself, which every answer has to name.
const FINAL_CHECK_MAX_GRADE = 7;

/**
 * Final safety check on the reviewer's own correction. Nobody else reviews that text, so
 * before it can be saved to the glossary, the code checks run on it once more. Returns the
 * problems found; any problem means the answer is shown but not saved.
 */
export function finalCheckProblems(answer) {
  const checks = mechanicalChecks(answer);
  const problems = [];
  const add = (rule, issue) => problems.push({ rule, issue: `Final check: ${issue}` });
  if (checks.possible_cause_or_advice.length) {
    add("1", `the corrected answer may still name a cause or give advice ("${checks.possible_cause_or_advice.join('", "')}")`);
  }
  if (checks.reading_grade != null && checks.reading_grade > FINAL_CHECK_MAX_GRADE) {
    add("2", `the corrected answer reads at about grade ${checks.reading_grade} (target: 6 or below)`);
  }
  if (checks.word_parts_repeating_term.length) add("3", "a word part repeats the whole term");
  if (checks.possible_personal_details_in.length) {
    add("4", `possible personal details in ${checks.possible_personal_details_in.join(", ")}`);
  }
  if (checks.question_count < 1) add("5", "no questions for the care team");
  return problems;
}

/**
 * Writer → automated checks → reviewer.
 *
 * The writer drafts an explanation. Code runs the rule checks a computer can do, and the
 * reviewer model checks the draft against the site's five rules with those results as
 * leads. If the reviewer finds problems, its corrected version replaces the draft.
 *
 * review.status is one of:
 *   "passed"     the reviewer approved the draft as written
 *   "revised"    the reviewer found problems and its corrected version is returned
 *   "unresolved" the reviewer found problems and either gave no usable correction (draft
 *                returned) or its correction failed the final check (correction returned)
 *   "skipped"    the reviewer couldn't run (overloaded, timed out, no time left) or is off
 *   "not_needed" the writer didn't understand the phrase, so there is nothing to review
 *
 * Only "passed" and "revised" answers should be saved to the glossary.
 * `attempts` collects every model call (role, model, outcome, seconds) for diagnostics.
 */
export async function explainAndReview(phrase, env, attempts = []) {
  const deadline = Date.now() + (Number(env.ANSWER_TIMEOUT_SECONDS) || DEFAULT_TOTAL_SECONDS) * 1000;
  const draft = await explainWithModel(phrase, env, deadline, attempts);
  if (!draft.understood) return { result: draft, review: { status: "not_needed", problems: [] } };
  if (env.AI_REVIEW === "off") return { result: draft, review: { status: "skipped", problems: [], reason: "review is turned off" } };
  if (deadline - Date.now() < MIN_REVIEW_SECONDS * 1000) {
    console.warn("Writer was slow; no time left to review, returning unreviewed draft");
    return { result: draft, review: { status: "skipped", problems: [], reason: "no time left to review" } };
  }

  let verdict;
  try {
    verdict = await reviewWithModel(phrase, draft, mechanicalChecks(draft), env, deadline, attempts);
  } catch (err) {
    // The draft is still a reasonable answer; show it, but don't save it as reviewed.
    console.error(`Reviewer failed, returning unreviewed draft: ${err.message}`);
    return { result: draft, review: { status: "skipped", problems: [], reason: err.message.slice(0, 200) } };
  }

  if (verdict.passed) return { result: draft, review: { status: "passed", problems: [] } };
  if (!verdict.revised) return { result: draft, review: { status: "unresolved", problems: verdict.problems } };

  const result = {
    ...verdict.revised,
    term: verdict.revised.term || draft.term,
    // Stay cautious: if either model saw personal details, treat the input as personal.
    has_personal_info: draft.has_personal_info || verdict.revised.has_personal_info,
    model: draft.model,
    reasoning_used: draft.reasoning_used,
  };
  const finalProblems = finalCheckProblems(result);
  if (finalProblems.length) {
    console.warn(`Reviewer's correction failed the final check: ${finalProblems.map((p) => p.issue).join("; ")}`);
    return { result, review: { status: "unresolved", problems: [...verdict.problems, ...finalProblems] } };
  }
  return { result, review: { status: "revised", problems: verdict.problems } };
}
