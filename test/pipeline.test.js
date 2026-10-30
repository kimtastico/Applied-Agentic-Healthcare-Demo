import { test } from "node:test";
import assert from "node:assert/strict";
import { explainAndReview } from "../src/pipeline.js";
import { mechanicalChecks } from "../src/lib.js";
import { REVIEW_PROMPT } from "../src/prompt.js";

const ENV = { NVIDIA_API_KEY: "k", NVIDIA_MODEL: "writer-model", NVIDIA_REASONING: "off" };

const draft = {
  understood: true,
  term: "atelectasis",
  has_personal_info: false,
  explanation: "Atelectasis means part of the lung has collapsed. This can happen after surgery.",
  word_parts: [{ word: "atelectasis", meaning: "a collapsed lung area" }],
  questions: ["What caused this?"],
};
const fixed = {
  ...draft,
  explanation: "Part of a lung has gone flat. That part does not fill with air.",
  word_parts: [{ word: "atelo", meaning: "incomplete" }],
};

const reply = (obj) => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(obj) } }] }));

// Fake NVIDIA: answers as the writer or the reviewer depending on the system prompt.
function fakeNvidia({ writer = draft, reviewer }) {
  const calls = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const isReview = body.messages[0].content === REVIEW_PROMPT;
    calls.push({ role: isReview ? "reviewer" : "writer", body });
    if (!isReview) return reply(writer);
    return typeof reviewer === "function" ? reviewer(body) : reply(reviewer);
  };
  return calls;
}

test("reviewer approves the draft", async () => {
  const calls = fakeNvidia({ writer: fixed, reviewer: { passed: true, problems: [], revised: null } });
  const { result, review } = await explainAndReview("atelectasis", ENV);
  assert.deepEqual(calls.map((c) => c.role), ["writer", "reviewer"]);
  assert.equal(review.status, "passed");
  assert.equal(result.explanation, fixed.explanation);
});

test("reviewer corrects a draft that names causes", async () => {
  const problems = [{ rule: 1, issue: 'Names a cause: "after surgery"' }];
  const calls = fakeNvidia({ reviewer: { passed: false, problems, revised: fixed } });
  const { result, review } = await explainAndReview("atelectasis", ENV);
  assert.equal(review.status, "revised");
  assert.deepEqual(review.problems, [{ rule: "1", issue: 'Names a cause: "after surgery"' }]);
  assert.equal(result.explanation, fixed.explanation);
  assert.equal(result.model, "writer-model");

  // The reviewer saw the original input, the draft, and the automated checks.
  const sent = calls[1].body.messages[1].content;
  assert.match(sent, /Original input: """atelectasis"""/);
  assert.match(sent, /This can happen after surgery/);
  assert.match(sent, /"possible_cause_or_advice":\["can happen","after surgery"/);
});

test("reviewer finds problems but gives no usable correction", async () => {
  fakeNvidia({ reviewer: { passed: false, problems: [{ rule: 2, issue: "Too hard" }], revised: null } });
  const { result, review } = await explainAndReview("atelectasis", ENV);
  assert.equal(review.status, "unresolved");
  assert.equal(result.explanation, draft.explanation);
});

test("reviewer outage returns the draft as unreviewed instead of failing", async () => {
  fakeNvidia({ reviewer: () => new Response('{"error":"Service temporarily overloaded"}', { status: 503 }) });
  const { result, review } = await explainAndReview("atelectasis", ENV);
  assert.equal(review.status, "skipped");
  assert.equal(result.explanation, draft.explanation);
});

test("personal details flagged by either model are kept", async () => {
  fakeNvidia({
    writer: { ...draft, has_personal_info: true },
    reviewer: { passed: false, problems: [{ rule: 4, issue: "Mentions a name" }], revised: { ...fixed, has_personal_info: false } },
  });
  const { result } = await explainAndReview("Mr. Smith atelectasis", ENV);
  assert.equal(result.has_personal_info, true);
});

test("not-understood input and NVIDIA_REVIEW=off skip the reviewer", async () => {
  let calls = fakeNvidia({ writer: { understood: false, explanation: "Not a medical phrase." }, reviewer: {} });
  assert.equal((await explainAndReview("banana bread", ENV)).review.status, "not_needed");
  assert.equal(calls.length, 1);

  calls = fakeNvidia({ reviewer: {} });
  assert.equal((await explainAndReview("atelectasis", { ...ENV, NVIDIA_REVIEW: "off" })).review.status, "skipped");
  assert.equal(calls.length, 1);
});

test("mechanicalChecks flags causes, repeated terms, and grade", () => {
  const c = mechanicalChecks(draft);
  assert.deepEqual(c.possible_cause_or_advice, ["can happen", "after surgery"]);
  assert.deepEqual(c.word_parts_repeating_term, ["atelectasis"]);
  assert.equal(c.question_count, 1);
  assert.ok(mechanicalChecks(fixed).reading_grade_ok);
});

// A model that never answers: the request only ends when the site's timeout aborts it.
// (Node's AbortSignal.timeout doesn't keep the test process alive, so hold it open.)
const stall = (init) =>
  new Promise((_, reject) => {
    const keepAlive = setTimeout(() => {}, 10_000);
    init.signal.addEventListener("abort", () => {
      clearTimeout(keepAlive);
      reject(init.signal.reason);
    });
  });

test("a stalled model times out and the next model answers", async () => {
  const tried = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    tried.push(body.model);
    if (body.model === "slow-model") return stall(init);
    const isReview = body.messages[0].content === REVIEW_PROMPT;
    return reply(isReview ? { passed: true, problems: [], revised: null } : fixed);
  };
  const env = { ...ENV, NVIDIA_MODEL: "slow-model, fast-model", NVIDIA_TIMEOUT_SECONDS: "0.05" };
  const { result, review } = await explainAndReview("atelectasis", env);
  assert.equal(result.model, "fast-model");
  assert.equal(review.status, "passed");
  // Writer: slow, then fast. Reviewer starts with the model that worked for the writer.
  assert.deepEqual(tried, ["slow-model", "fast-model", "fast-model"]);
});

test("when the writer uses up the time budget, the draft comes back unreviewed", async () => {
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    await new Promise((r) => setTimeout(r, 80));
    return reply(fixed);
  };
  // 0.5s total budget: enough for the writer, less than the 10s a review needs.
  const { result, review } = await explainAndReview("atelectasis", { ...ENV, NVIDIA_TOTAL_SECONDS: "0.5" });
  assert.equal(review.status, "skipped");
  assert.equal(result.explanation, fixed.explanation);
  assert.equal(calls, 1);
});

test("all models stalled gives a clear timeout error", async () => {
  globalThis.fetch = async (_url, init) => stall(init);
  const env = { ...ENV, NVIDIA_MODEL: "a, b", NVIDIA_TIMEOUT_SECONDS: "0.05" };
  await assert.rejects(explainAndReview("atelectasis", env), /b: no answer within 0s/);
});
