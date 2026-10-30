import { test } from "node:test";
import assert from "node:assert/strict";
import { explainAndReview } from "../src/pipeline.js";
import { mechanicalChecks } from "../src/lib.js";
import { REVIEW_PROMPT } from "../src/prompt.js";

const ENV = { NVIDIA_API_KEY: "k", WRITER_MODELS: "writer-model", NVIDIA_REASONING: "off" };

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
  // Clean checks are left out so the reviewer doesn't invent problems from them.
  assert.doesNotMatch(sent, /possible_personal_details_in/);
});

test("reviewer finds problems but gives no usable correction", async () => {
  fakeNvidia({ reviewer: { passed: false, problems: [{ rule: 2, issue: "Too hard" }], revised: null } });
  const { result, review } = await explainAndReview("atelectasis", ENV);
  assert.equal(review.status, "unresolved");
  assert.equal(result.explanation, draft.explanation);
});

test("reviewer outage returns the draft as unreviewed instead of failing", async () => {
  fakeNvidia({ reviewer: () => new Response('{"error":"Service temporarily overloaded"}', { status: 503 }) });
  const { result, review } = await explainAndReview("atelectasis", { ...ENV, RETRY_PAUSE_MS: "10" });
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

test("not-understood input and AI_REVIEW=off skip the reviewer", async () => {
  let calls = fakeNvidia({ writer: { understood: false, explanation: "Not a medical phrase." }, reviewer: {} });
  assert.equal((await explainAndReview("banana bread", ENV)).review.status, "not_needed");
  assert.equal(calls.length, 1);

  calls = fakeNvidia({ reviewer: {} });
  assert.equal((await explainAndReview("atelectasis", { ...ENV, AI_REVIEW: "off" })).review.status, "skipped");
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
  const env = { ...ENV, WRITER_MODELS: "slow-model, fast-model", MODEL_TIMEOUT_SECONDS: "0.05" };
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
  const { result, review } = await explainAndReview("atelectasis", { ...ENV, ANSWER_TIMEOUT_SECONDS: "0.5" });
  assert.equal(review.status, "skipped");
  assert.equal(result.explanation, fixed.explanation);
  assert.equal(calls, 1);
});

test("all models stalled gives a clear timeout error", async () => {
  globalThis.fetch = async (_url, init) => stall(init);
  const env = { ...ENV, WRITER_MODELS: "a, b", MODEL_TIMEOUT_SECONDS: "0.05" };
  await assert.rejects(explainAndReview("atelectasis", env), /b: no answer within 0s/);
});

test("a weak writer fallback never reviews: reviewer list is separate, failed models are skipped", async () => {
  const tried = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const role = body.messages[0].content === REVIEW_PROMPT ? "reviewer" : "writer";
    tried.push(`${role}:${body.model}`);
    if (body.model === "strong") return new Response('{"error":"Service temporarily overloaded"}', { status: 503 });
    return reply(role === "reviewer" ? { passed: true, problems: [], revised: null } : fixed);
  };
  const attempts = [];
  const env = { ...ENV, WRITER_MODELS: "strong, weak", REVIEWER_MODELS: "strong", RETRY_PAUSE_MS: "10" };
  const { result, review } = await explainAndReview("atelectasis", env, attempts);
  assert.equal(result.model, "weak");
  // "strong" already failed for the writer and "weak" isn't a reviewer, so no review runs.
  assert.equal(review.status, "skipped");
  assert.deepEqual(tried, ["writer:strong", "writer:strong", "writer:weak"]);
  assert.deepEqual(attempts.map((a) => [a.role, a.model, a.outcome.slice(0, 8)]), [
    ["writer", "strong", "HTTP 503"],
    ["writer", "strong", "HTTP 503"],
    ["writer", "weak", "ok"],
  ]);
});

test("the reviewer uses its own model list", async () => {
  const tried = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const role = body.messages[0].content === REVIEW_PROMPT ? "reviewer" : "writer";
    tried.push(`${role}:${body.model}`);
    return reply(role === "reviewer" ? { passed: true, problems: [], revised: null } : fixed);
  };
  const env = { ...ENV, WRITER_MODELS: "fast-writer", REVIEWER_MODELS: "careful-reviewer" };
  const { review } = await explainAndReview("atelectasis", env);
  assert.equal(review.status, "passed");
  assert.deepEqual(tried, ["writer:fast-writer", "reviewer:careful-reviewer"]);
});

test("an overloaded model is retried once, then reused by the reviewer", async () => {
  const tried = [];
  let writerCalls = 0;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    const role = body.messages[0].content === REVIEW_PROMPT ? "reviewer" : "writer";
    tried.push(`${role}:${body.model}`);
    if (role === "writer" && ++writerCalls === 1) {
      return new Response('{"error":"Service temporarily overloaded"}', { status: 503 });
    }
    return reply(role === "reviewer" ? { passed: true, problems: [], revised: null } : fixed);
  };
  const attempts = [];
  const env = { ...ENV, WRITER_MODELS: "ultra, backup", REVIEWER_MODELS: "ultra", RETRY_PAUSE_MS: "10" };
  const { result, review } = await explainAndReview("atelectasis", env, attempts);
  assert.equal(result.model, "ultra");
  assert.equal(review.status, "passed");
  assert.deepEqual(tried, ["writer:ultra", "writer:ultra", "reviewer:ultra"]);
  assert.match(attempts[0].outcome, /HTTP 503.*\(retrying\)/);
  assert.equal(attempts[1].outcome, "ok");
});

test("a model still overloaded after its retry falls back to the next", async () => {
  const tried = [];
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    tried.push(body.model);
    if (body.model === "ultra") return new Response('{"error":"overloaded"}', { status: 503 });
    return reply(fixed);
  };
  const env = { ...ENV, WRITER_MODELS: "ultra, backup", AI_REVIEW: "off", RETRY_PAUSE_MS: "10" };
  const { result } = await explainAndReview("atelectasis", env);
  assert.equal(result.model, "backup");
  assert.deepEqual(tried, ["ultra", "ultra", "backup"]);
});

// --- Cloudflare Workers AI ---------------------------------------------------------

const LLAMA = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const GPT_OSS = "@cf/openai/gpt-oss-120b";

// Fake Workers AI binding: Llama-style models return { response: string };
// gpt-oss returns an OpenAI-style { choices: [...] }.
function fakeWorkersAi(handlers) {
  const runs = [];
  const AI = {
    async run(model, input) {
      runs.push({ model, input });
      return handlers[model](input);
    },
  };
  return { AI, runs };
}
const llamaReply = (obj) => ({ response: JSON.stringify(obj) });
const gptOssReply = (obj) => ({ choices: [{ finish_reason: "stop", message: { role: "assistant", content: JSON.stringify(obj) } }] });

test("Workers AI: Llama writes, gpt-oss reviews and corrects", async () => {
  const problems = [{ rule: 1, issue: 'Names a cause: "after surgery"' }];
  const { AI, runs } = fakeWorkersAi({
    [LLAMA]: () => llamaReply(draft),
    [GPT_OSS]: () => gptOssReply({ passed: false, problems, revised: fixed }),
  });
  const env = { AI, WRITER_MODELS: LLAMA, REVIEWER_MODELS: GPT_OSS };
  const { result, review } = await explainAndReview("atelectasis", env);

  assert.equal(result.model, LLAMA);
  assert.equal(result.explanation, fixed.explanation);
  assert.equal(review.status, "revised");
  assert.deepEqual(runs.map((r) => r.model), [LLAMA, GPT_OSS]);
  // Temperature 0 and room for the whole JSON answer (Workers AI defaults to 256 tokens).
  assert.equal(runs[0].input.temperature, 0);
  assert.equal(runs[0].input.max_tokens, 1024);
  assert.equal(runs[0].input.messages[0].role, "system");
  assert.equal(runs[0].input.reasoning_effort, undefined);
  // gpt-oss always reasons; keep it quick.
  assert.equal(runs[1].input.temperature, 0);
  assert.equal(runs[1].input.reasoning_effort, "low");
  assert.equal(runs[1].input.messages[0].content, REVIEW_PROMPT);
});

test("Workers AI: a JSON-mode object response is accepted", async () => {
  const { AI } = fakeWorkersAi({ [LLAMA]: () => ({ response: fixed }) });
  const { result } = await explainAndReview("atelectasis", { AI, WRITER_MODELS: LLAMA, AI_REVIEW: "off" });
  assert.equal(result.explanation, fixed.explanation);
});

test("Workers AI out of daily allowance falls back to NVIDIA", async () => {
  const { AI } = fakeWorkersAi({
    [LLAMA]: () => {
      throw new Error("AiError: 4006: you have used up your daily free allocation of 10,000 neurons");
    },
  });
  fakeNvidia({ writer: fixed, reviewer: { passed: true, problems: [], revised: null } });
  const attempts = [];
  const env = { ...ENV, AI, WRITER_MODELS: `${LLAMA}, nvidia/ultra`, REVIEWER_MODELS: "nvidia/ultra" };
  const { result, review } = await explainAndReview("atelectasis", env, attempts);
  assert.equal(result.model, "nvidia/ultra");
  assert.equal(review.status, "passed");
  assert.match(attempts[0].outcome, /daily free allocation/);
});

test("Workers AI: a stalled model times out and the next answers", async () => {
  const { AI } = fakeWorkersAi({
    [LLAMA]: () => new Promise((resolve) => setTimeout(() => resolve(llamaReply(draft)), 2000)),
    [GPT_OSS]: () => gptOssReply(fixed),
  });
  const env = { AI, WRITER_MODELS: `${LLAMA}, ${GPT_OSS}`, AI_REVIEW: "off", MODEL_TIMEOUT_SECONDS: "0.05" };
  const attempts = [];
  const { result } = await explainAndReview("atelectasis", env, attempts);
  assert.equal(result.model, GPT_OSS);
  assert.equal(attempts[0].outcome, "no answer within 0s");
});

test("without the AI binding, @cf models are skipped and NVIDIA answers", async () => {
  fakeNvidia({ writer: fixed });
  const attempts = [];
  const env = { ...ENV, WRITER_MODELS: `${LLAMA}, nvidia/ultra`, AI_REVIEW: "off" };
  const { result } = await explainAndReview("atelectasis", env, attempts);
  assert.equal(result.model, "nvidia/ultra");
  assert.match(attempts[0].outcome, /binding \(AI\) is not configured/);
});

test('a reviewer verdict written as text ("true") is accepted', async () => {
  const { AI } = fakeWorkersAi({
    [LLAMA]: () => llamaReply(fixed),
    [GPT_OSS]: () => gptOssReply({ passed: "true", problems: [], revised: null }),
  });
  const { review } = await explainAndReview("atelectasis", { AI, WRITER_MODELS: LLAMA, REVIEWER_MODELS: GPT_OSS });
  assert.equal(review.status, "passed");
});

test("a skipped review says why", async () => {
  const { AI } = fakeWorkersAi({
    [LLAMA]: () => llamaReply(fixed),
    [GPT_OSS]: () => ({ choices: [{ finish_reason: "length", message: { content: "Let me check the rules one by one" } }] }),
  });
  const { review } = await explainAndReview("atelectasis", { AI, WRITER_MODELS: LLAMA, REVIEWER_MODELS: GPT_OSS });
  assert.equal(review.status, "skipped");
  assert.match(review.reason, /finish_reason: length.*reply began: Let me check/);
});

// --- Final check on the reviewer's correction --------------------------------------

test("a clean correction passes the final check and is marked revised", async () => {
  fakeNvidia({ reviewer: { passed: false, problems: [{ rule: 1, issue: "Names a cause" }], revised: fixed } });
  const { review } = await explainAndReview("atelectasis", ENV);
  assert.equal(review.status, "revised");
});

test("a correction that still names a cause fails the final check and isn't saved", async () => {
  const stillBad = { ...fixed, explanation: "Part of a lung has gone flat. This can happen after surgery." };
  fakeNvidia({ reviewer: { passed: false, problems: [{ rule: 2, issue: "Too hard" }], revised: stillBad } });
  const { result, review } = await explainAndReview("atelectasis", ENV);
  // The visitor still sees the (better) correction, but the glossary won't keep it.
  assert.equal(result.explanation, stillBad.explanation);
  assert.equal(review.status, "unresolved");
  assert.equal(review.problems[0].issue, "Too hard");
  assert.match(review.problems[1].issue, /^Final check: .*cause or give advice \("can happen", "after surgery"\)/);
});

test("the final check catches a hard reading level, a repeated term, and missing questions", async () => {
  const hard = {
    ...fixed,
    explanation: "Radiographic evaluation demonstrates bilateral pulmonary atelectasis with associated volume reduction.",
    word_parts: [{ word: "atelectasis", meaning: "incomplete expansion" }],
    questions: [],
  };
  fakeNvidia({ reviewer: { passed: false, problems: [], revised: hard } });
  const { review } = await explainAndReview("atelectasis", ENV);
  assert.equal(review.status, "unresolved");
  const issues = review.problems.map((p) => p.issue).join(" | ");
  assert.match(issues, /reads at about grade/);
  assert.match(issues, /word part repeats the whole term/);
  assert.match(issues, /no questions for the care team/);
});

test("a correct definition that says 'too high' isn't blocked by the final check", async () => {
  const hyperkalemia = {
    understood: true,
    term: "hyperkalemia",
    has_personal_info: false,
    explanation: "The potassium in your blood is too high. Potassium helps your heart and muscles work.",
    word_parts: [{ word: "hyper", meaning: "above, too much" }, { word: "kal", meaning: "potassium" }],
    questions: ["What does this mean for me?"],
  };
  fakeNvidia({ reviewer: { passed: false, problems: [{ rule: 3, issue: "Missing word parts" }], revised: hyperkalemia } });
  const { review } = await explainAndReview("hyperkalemia", ENV);
  assert.equal(review.status, "revised");
});

test("the potassium worked example spells out each part of its unit, without a normal range", async () => {
  const { buildMessages } = await import("../src/prompt.js");
  const messages = buildMessages("sodium 128 mmol/L");
  const potassium = JSON.parse(messages.find((m) => m.role === "assistant" && m.content.includes("potassium")).content);
  assert.deepEqual(
    potassium.word_parts.map((p) => [p.word, p.meaning.split(":")[0]]),
    [["mmol", "millimoles"], ["L", "liter"]],
  );
  assert.doesNotMatch(JSON.stringify(potassium.word_parts), /\d/);
});

test("an approved draft is not re-checked (the reviewer already judged the code's findings)", async () => {
  // The code would flag "risk", but the reviewer saw that and approved the draft.
  const approved = { ...fixed, explanation: "This test shows your risk of a blood clot." };
  fakeNvidia({ writer: approved, reviewer: { passed: true, problems: [], revised: null } });
  const { review } = await explainAndReview("d-dimer", ENV);
  assert.equal(review.status, "passed");
});
