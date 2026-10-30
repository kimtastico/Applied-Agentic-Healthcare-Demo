import { mechanicalChecks } from "./lib.js";
import { explainWithNvidia, reviewWithNvidia } from "./nvidia.js";

// The whole answer (writer, plus reviewer if there's time) should arrive within this,
// so visitors aren't left waiting on a stalled free endpoint.
const DEFAULT_TOTAL_SECONDS = 55;
// Don't start a review that can't finish: below this, the draft is returned unreviewed.
const MIN_REVIEW_SECONDS = 10;

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
 *   "unresolved" the reviewer found problems but gave no usable correction (draft returned)
 *   "skipped"    the reviewer couldn't run (overloaded, timed out, no time left) or is off
 *   "not_needed" the writer didn't understand the phrase, so there is nothing to review
 *
 * Only "passed" and "revised" answers should be saved to the glossary.
 */
export async function explainAndReview(phrase, env) {
  const deadline = Date.now() + (Number(env.NVIDIA_TOTAL_SECONDS) || DEFAULT_TOTAL_SECONDS) * 1000;
  const draft = await explainWithNvidia(phrase, env, deadline);
  if (!draft.understood) return { result: draft, review: { status: "not_needed", problems: [] } };
  if (env.NVIDIA_REVIEW === "off") return { result: draft, review: { status: "skipped", problems: [] } };
  if (deadline - Date.now() < MIN_REVIEW_SECONDS * 1000) {
    console.warn("Writer was slow; no time left to review, returning unreviewed draft");
    return { result: draft, review: { status: "skipped", problems: [] } };
  }

  let verdict;
  try {
    verdict = await reviewWithNvidia(phrase, draft, mechanicalChecks(draft), env, deadline);
  } catch (err) {
    // The draft is still a reasonable answer; show it, but don't save it as reviewed.
    console.error(`Reviewer failed, returning unreviewed draft: ${err.message}`);
    return { result: draft, review: { status: "skipped", problems: [] } };
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
  return { result, review: { status: "revised", problems: verdict.problems } };
}
