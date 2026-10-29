import { buildMessages } from "./prompt.js";
import { extractJson, sanitizeExplanation } from "./lib.js";

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";

/** The chat-completions request body. /api/health/ai shows its settings (not the messages). */
export function requestBody(phrase, env, reasoning) {
  // Optional cap on thinking tokens. Not every NVIDIA server supports it
  // (Nemotron Ultra rejects it), so it's only sent when configured.
  const reasoningBudget = Number(env.NVIDIA_REASONING_BUDGET) || 0;
  return {
    model: env.NVIDIA_MODEL || DEFAULT_MODEL,
    messages: buildMessages(phrase),
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

async function callNvidia(phrase, env, reasoning) {
  const baseUrl = (env.NVIDIA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify(requestBody(phrase, env, reasoning)),
    signal: AbortSignal.timeout(60_000),
  });
  if (res.ok) return { res };

  // Include NVIDIA's reason (e.g. an unsupported setting) so failures can be diagnosed
  // from the logs, but blank out the user's phrase in case the error echoes it.
  let detail = await res.text().catch(() => "");
  for (const form of [phrase, JSON.stringify(phrase).slice(1, -1)]) detail = detail.split(form).join("[phrase]");
  return { status: res.status, detail: detail.slice(0, 300) };
}

/**
 * Ask an NVIDIA-hosted model (OpenAI-compatible chat completions API) to explain a phrase.
 * temperature is pinned to 0: these are factual definitions, and creativity is a bug.
 */
export async function explainWithNvidia(phrase, env) {
  let reasoning = env.NVIDIA_REASONING !== "off";
  let attempt = await callNvidia(phrase, env, reasoning);

  // Some NVIDIA servers reject thinking-related settings (Ultra: "thinking_token_budget
  // is not yet supported"). Rather than fail, retry once with reasoning off.
  if (!attempt.res && reasoning && attempt.status === 400 && /think|reason/i.test(attempt.detail)) {
    console.warn(`Reasoning rejected by NVIDIA, retrying without it: ${attempt.detail}`);
    reasoning = false;
    attempt = await callNvidia(phrase, env, reasoning);
  }
  if (!attempt.res) throw new Error(`NVIDIA API returned HTTP ${attempt.status}: ${attempt.detail}`);

  const data = await attempt.res.json();
  const choice = data?.choices?.[0];
  const result = sanitizeExplanation(extractJson(choice?.message?.content));
  if (!result) {
    // finish_reason "length" means thinking used up max_tokens before the answer.
    throw new Error(`Model reply was not valid JSON (finish_reason: ${choice?.finish_reason ?? "unknown"})`);
  }
  return { ...result, model: env.NVIDIA_MODEL || DEFAULT_MODEL, reasoning_used: reasoning };
}
