import { buildMessages, buildReviewMessages } from "./prompt.js";
import { extractJson, sanitizeExplanation } from "./lib.js";

// Two providers, picked by model name:
// - "@cf/..." models run on Cloudflare Workers AI through the AI binding (free daily allowance).
// - Anything else goes to NVIDIA's OpenAI-compatible API (free trial, often overloaded).
const DEFAULT_WRITER_MODELS = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const NVIDIA_BASE_URL = "https://integrate.api.nvidia.com/v1";

// Errors that mean "this model can't serve this request right now" (bad setting for this
// model, not found, retired, rate-limited, overloaded, too slow, unreachable, out of daily
// allowance): worth trying the next model. Key errors (401/403) are not: every NVIDIA model
// would fail the same way.
const FALLBACK_STATUSES = new Set([400, 404, 410, 422, 429, 500, 502, 503, 504, "timeout", "network", "workers-ai", "unavailable"]);

// How long one model gets before the next one is tried, so a stalled model
// doesn't hold up the whole answer.
const DEFAULT_MODEL_TIMEOUT_SECONDS = 15;

// NVIDIA's "overloaded" and "rate-limited" usually clear within seconds, so these get
// one retry after a short pause before moving to the next model.
const RETRY_STATUSES = new Set([429, 503]);
const RETRY_PAUSE_MS = 1500;

const isWorkersAi = (model) => model.startsWith("@cf/");

/**
 * WRITER_MODELS lists the writer's models, comma-separated, tried in order.
 * REVIEWER_MODELS lists the reviewer's (defaults to the writer's list).
 */
export function modelList(env, key = "WRITER_MODELS") {
  const raw = env[key] || env.WRITER_MODELS || DEFAULT_WRITER_MODELS;
  return raw.split(",").map((m) => m.trim()).filter(Boolean);
}

/** True when at least one provider is set up: the Workers AI binding or an NVIDIA key. */
export function aiConfigured(env) {
  return Boolean(env.AI || env.NVIDIA_API_KEY);
}

/** The NVIDIA chat-completions request body. */
export function nvidiaRequestBody(messages, env, model, reasoning) {
  // Optional cap on thinking tokens. Not every NVIDIA server supports it
  // (Nemotron Ultra rejects it), so it's only sent when configured.
  const reasoningBudget = Number(env.NVIDIA_REASONING_BUDGET) || 0;
  return {
    model,
    messages,
    temperature: 0,
    top_p: 1,
    // Reasoning lets the model plan before answering, which makes it follow the
    // rules (no causes, plain words) more reliably.
    chat_template_kwargs: { enable_thinking: reasoning },
    ...(reasoning && reasoningBudget > 0 && { reasoning_budget: reasoningBudget }),
    // Room for thinking plus the ~300-token JSON answer.
    max_tokens: 8192,
    stream: false,
  };
}

/** Every provider returns { content, finishReason } on success, or { status, detail } on failure. */
async function callNvidia(messages, phrase, env, model, reasoning, timeoutMs) {
  if (!env.NVIDIA_API_KEY) return { status: "unavailable", detail: "NVIDIA_API_KEY is not set" };
  const baseUrl = (env.NVIDIA_BASE_URL || NVIDIA_BASE_URL).replace(/\/+$/, "");
  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(nvidiaRequestBody(messages, env, model, reasoning)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Read the body inside the try too: the timeout also covers a slow response body.
    if (res.ok) {
      const choice = (await res.json())?.choices?.[0];
      return { content: choice?.message?.content, finishReason: choice?.finish_reason };
    }
  } catch (err) {
    if (err?.name === "TimeoutError" || err?.name === "AbortError") {
      return { status: "timeout", detail: `no answer within ${Math.round(timeoutMs / 1000)}s` };
    }
    return { status: "network", detail: String(err?.message ?? err).slice(0, 200) };
  }

  // Include NVIDIA's reason (e.g. an unsupported setting) so failures can be diagnosed
  // from the logs, but blank out the user's phrase in case the error echoes it.
  let detail = await res.text().catch(() => "");
  for (const form of [phrase, JSON.stringify(phrase).slice(1, -1)]) detail = detail.split(form).join("[phrase]");
  return { status: res.status, detail: detail.slice(0, 300) };
}

async function callWorkersAi(messages, env, model, timeoutMs) {
  if (!env.AI) return { status: "unavailable", detail: "Workers AI binding (AI) is not configured" };
  // gpt-oss always reasons (it can't be turned off); "low" effort keeps it quick.
  const reasons = model.includes("gpt-oss");
  const input = {
    messages,
    temperature: 0,
    // Workers AI defaults to 256 output tokens, which would cut the JSON answer short.
    max_tokens: reasons ? 4096 : 1024,
    ...(reasons && { reasoning_effort: "low" }),
  };
  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(
      () => resolve({ status: "timeout", detail: `no answer within ${Math.round(timeoutMs / 1000)}s` }),
      timeoutMs,
    );
  });
  try {
    const call = env.AI.run(model, input).then((out) => {
      // Llama-style models return { response }; OpenAI-style models return { choices }.
      // In JSON mode `response` can already be an object.
      const choice = out?.choices?.[0];
      const response = out?.response;
      const content = choice
        ? choice.message?.content
        : typeof response === "string"
          ? response
          : response && JSON.stringify(response);
      return { content, finishReason: choice?.finish_reason ?? "stop" };
    });
    // If the timeout wins, a late failure from the abandoned call is ignored.
    call.catch(() => {});
    return await Promise.race([call, timeout]);
  } catch (err) {
    // e.g. the daily free allowance is used up, or the model is unavailable.
    return { status: "workers-ai", detail: String(err?.message ?? err).slice(0, 300) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Try `models` in order. Every attempt is recorded in `attempts` (role, model, outcome,
 * seconds) so /api/health/ai can show why a model was skipped. `phrase` is the user's
 * text, blanked out of any logged error. temperature is pinned to 0 everywhere: these
 * are factual definitions, and creativity is a bug.
 */
async function chat(messages, phrase, env, deadline, { role, models, attempts }) {
  const perModelMs = (Number(env.MODEL_TIMEOUT_SECONDS) || DEFAULT_MODEL_TIMEOUT_SECONDS) * 1000;
  // Each attempt gets the per-model limit, or whatever is left before the deadline.
  const timeLeft = () => Math.min(perModelMs, deadline - Date.now());
  const outOfTime = () => deadline - Date.now() < 250;
  let lastError = "no models available";

  for (const [i, model] of models.entries()) {
    if (outOfTime()) throw new Error(`Out of time before trying ${model} (last: ${lastError})`);
    const started = Date.now();
    const record = (outcome) => attempts.push({ role, model, outcome, seconds: (Date.now() - started) / 1000 });
    let reasoning = env.NVIDIA_REASONING !== "off";
    const call = () =>
      isWorkersAi(model)
        ? callWorkersAi(messages, env, model, timeLeft())
        : callNvidia(messages, phrase, env, model, reasoning, timeLeft());
    let attempt = await call();

    // Some NVIDIA servers reject thinking-related settings (Ultra: "thinking_token_budget
    // is not yet supported"). Rather than fail, retry once with reasoning off.
    if (attempt.status === 400 && reasoning && /think|reason/i.test(attempt.detail) && !outOfTime()) {
      console.warn(`${model}: reasoning rejected, retrying without it: ${attempt.detail}`);
      reasoning = false;
      attempt = await call();
    }
    if (RETRY_STATUSES.has(attempt.status) && deadline - Date.now() > RETRY_PAUSE_MS + 1000) {
      record(`HTTP ${attempt.status}: ${attempt.detail} (retrying)`);
      await new Promise((resolve) => setTimeout(resolve, Number(env.RETRY_PAUSE_MS ?? RETRY_PAUSE_MS)));
      attempt = await call();
    }
    if (attempt.status === undefined) {
      record("ok");
      return { ...attempt, model, reasoning: isWorkersAi(model) ? model.includes("gpt-oss") : reasoning };
    }

    const outcome = typeof attempt.status === "number" ? `HTTP ${attempt.status}: ${attempt.detail}` : attempt.detail;
    record(outcome);
    lastError = `${model}: ${outcome}`;
    if (i < models.length - 1 && FALLBACK_STATUSES.has(attempt.status)) {
      console.warn(`${lastError} (trying ${models[i + 1]})`);
      continue;
    }
    throw new Error(lastError);
  }
  throw new Error(lastError);
}

// finish_reason "length" means the model ran out of room before finishing the answer.
const notJson = (reply) =>
  new Error(`${reply.model}: reply was not valid JSON (finish_reason: ${reply.finishReason ?? "unknown"})`);

/** Writer: draft a plain-English explanation of the phrase. */
export async function explainWithModel(phrase, env, deadline = Date.now() + 55_000, attempts = []) {
  const reply = await chat(buildMessages(phrase), phrase, env, deadline, {
    role: "writer",
    models: modelList(env),
    attempts,
  });
  const result = sanitizeExplanation(extractJson(reply.content));
  if (!result) throw notJson(reply);
  return { ...result, model: reply.model, reasoning_used: reply.reasoning };
}

/**
 * Reviewer: check a draft against the rules; returns { passed, problems, revised }.
 * Only models on the reviewer list are used: a weak reviewer over-corrects and can make
 * a good answer worse. Models that failed and never succeeded in this request are skipped.
 */
export async function reviewWithModel(phrase, draft, checks, env, deadline = Date.now() + 55_000, attempts = []) {
  const ok = new Set(attempts.filter((a) => a.outcome === "ok").map((a) => a.model));
  const failed = new Set(attempts.map((a) => a.model).filter((m) => !ok.has(m)));
  const models = modelList(env, "REVIEWER_MODELS").filter((m) => !failed.has(m));
  if (!models.length) throw new Error("No reviewer model available (all failed earlier in this request)");
  const reply = await chat(buildReviewMessages(phrase, draft, checks), phrase, env, deadline, {
    role: "reviewer",
    models,
    attempts,
  });
  const raw = extractJson(reply.content);
  if (!raw || typeof raw.passed !== "boolean") throw notJson(reply);
  const problems = Array.isArray(raw.problems)
    ? raw.problems
        .map((p) => ({ rule: String(p?.rule ?? "").slice(0, 20), issue: String(p?.issue ?? "").trim().slice(0, 300) }))
        .filter((p) => p.issue)
        .slice(0, 8)
    : [];
  const revised = raw.passed ? null : sanitizeExplanation(raw.revised);
  return { passed: raw.passed, problems, revised: revised?.understood ? revised : null, model: reply.model };
}
