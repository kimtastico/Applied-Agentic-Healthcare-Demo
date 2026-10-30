import { buildMessages, buildReviewMessages } from "./prompt.js";
import { extractJson, sanitizeExplanation } from "./lib.js";

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

// Errors that mean "this model can't serve this request right now" (bad setting for this
// model, not found, retired, rate-limited, overloaded, too slow, unreachable): worth trying
// the next model. Key errors (401/403) are not: every model would fail.
const FALLBACK_STATUSES = new Set([400, 404, 410, 422, 429, 500, 502, 503, 504, "timeout", "network"]);

// How long one model gets before the next one is tried. Free endpoints are shared and
// can stall under load, so a slow model shouldn't hold up the whole answer.
const DEFAULT_MODEL_TIMEOUT_SECONDS = 25;

/**
 * NVIDIA_MODEL lists the writer's models, comma-separated, tried in order.
 * NVIDIA_REVIEW_MODEL lists the reviewer's (defaults to the writer's list).
 */
export function modelList(env, key = "NVIDIA_MODEL") {
  const raw = env[key] || env.NVIDIA_MODEL || DEFAULT_MODEL;
  const models = raw.split(",").map((m) => m.trim()).filter(Boolean);
  return models.length ? models : [DEFAULT_MODEL];
}

/** The chat-completions request body. /api/health/ai shows its settings (not the messages). */
export function requestBody(messages, env, model, reasoning) {
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
    // Room for unbounded thinking plus the ~300-token JSON answer.
    max_tokens: 8192,
    stream: false,
  };
}

async function callNvidia(messages, phrase, env, model, reasoning, timeoutMs) {
  const baseUrl = (env.NVIDIA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(requestBody(messages, env, model, reasoning)),
      signal: AbortSignal.timeout(timeoutMs),
    });
    // Read the body inside the try too: the timeout also covers a slow response body.
    if (res.ok) return { data: await res.json() };
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

/**
 * Send one chat to an NVIDIA-hosted model (OpenAI-compatible API), trying the configured
 * models in order. `phrase` is the user's text, blanked out of any logged error.
 * temperature is pinned to 0: these are factual definitions, and creativity is a bug.
 */
/**
 * Try `models` in order. Every attempt is recorded in `attempts` (role, model, outcome,
 * seconds) so /api/health/ai can show why a model was skipped.
 */
async function chat(messages, phrase, env, deadline, { role, models, attempts }) {
  const perModelMs = (Number(env.NVIDIA_TIMEOUT_SECONDS) || DEFAULT_MODEL_TIMEOUT_SECONDS) * 1000;
  // Each attempt gets the per-model limit, or whatever is left before the deadline.
  const timeLeft = () => Math.min(perModelMs, deadline - Date.now());
  const outOfTime = () => deadline - Date.now() < 250;
  let lastError = "no models available";

  for (const [i, model] of models.entries()) {
    if (outOfTime()) throw new Error(`Out of time before trying ${model} (last: ${lastError})`);
    const started = Date.now();
    const record = (outcome) => attempts.push({ role, model, outcome, seconds: (Date.now() - started) / 1000 });
    let reasoning = env.NVIDIA_REASONING !== "off";
    let attempt = await callNvidia(messages, phrase, env, model, reasoning, timeLeft());

    // Some NVIDIA servers reject thinking-related settings (Ultra: "thinking_token_budget
    // is not yet supported"). Rather than fail, retry once with reasoning off.
    if (!attempt.data && reasoning && attempt.status === 400 && /think|reason/i.test(attempt.detail) && !outOfTime()) {
      console.warn(`${model}: reasoning rejected, retrying without it: ${attempt.detail}`);
      reasoning = false;
      attempt = await callNvidia(messages, phrase, env, model, reasoning, timeLeft());
    }
    if (attempt.data) {
      record("ok");
      const choice = attempt.data?.choices?.[0];
      return { content: choice?.message?.content, finishReason: choice?.finish_reason, model, reasoning };
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

// finish_reason "length" means thinking used up max_tokens before the answer.
const notJson = (reply) =>
  new Error(`${reply.model}: reply was not valid JSON (finish_reason: ${reply.finishReason ?? "unknown"})`);

/** Writer: draft a plain-English explanation of the phrase. */
export async function explainWithNvidia(phrase, env, deadline = Date.now() + 55_000, attempts = []) {
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
 * a good answer worse. Models that already failed in this request are skipped.
 */
export async function reviewWithNvidia(phrase, draft, checks, env, deadline = Date.now() + 55_000, attempts = []) {
  const failed = new Set(attempts.filter((a) => a.outcome !== "ok").map((a) => a.model));
  const models = modelList(env, "NVIDIA_REVIEW_MODEL").filter((m) => !failed.has(m));
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
