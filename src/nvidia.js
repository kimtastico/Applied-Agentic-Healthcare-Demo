import { buildMessages } from "./prompt.js";
import { extractJson, sanitizeExplanation } from "./lib.js";

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "nvidia/nemotron-3-ultra-550b-a55b";
const REASONING_BUDGET = 1024;

/**
 * Ask an NVIDIA-hosted model (OpenAI-compatible chat completions API) to explain a phrase.
 * temperature is pinned to 0: these are factual definitions, and creativity is a bug.
 */
export async function explainWithNvidia(phrase, env) {
  const baseUrl = (env.NVIDIA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = env.NVIDIA_MODEL || DEFAULT_MODEL;
  const reasoning = env.NVIDIA_REASONING !== "off";

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      messages: buildMessages(phrase),
      temperature: 0,
      top_p: 1,
      // Reasoning lets the model plan before answering, which makes it follow the
      // rules (no causes, plain words) more reliably. The budget caps the thinking
      // so answers stay fast; a short definition needs very little.
      chat_template_kwargs: { enable_thinking: reasoning },
      ...(reasoning && { reasoning_budget: REASONING_BUDGET }),
      // Thinking + the ~300-token JSON answer.
      max_tokens: 4096,
      stream: false,
    }),
    signal: AbortSignal.timeout(60_000),
  });

  if (!res.ok) {
    // Include NVIDIA's reason (e.g. an unsupported setting) so failures can be diagnosed
    // from the logs, but blank out the user's phrase in case the error echoes it.
    let detail = await res.text().catch(() => "");
    for (const form of [phrase, JSON.stringify(phrase).slice(1, -1)]) detail = detail.split(form).join("[phrase]");
    detail = detail.slice(0, 300);
    throw new Error(`NVIDIA API returned HTTP ${res.status}: ${detail}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  const result = sanitizeExplanation(extractJson(content));
  if (!result) throw new Error("Model reply was not valid JSON");
  return { ...result, model };
}
