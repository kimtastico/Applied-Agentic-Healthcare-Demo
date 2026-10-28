import { SYSTEM_PROMPT, userMessage } from "./prompt.js";
import { extractJson, sanitizeExplanation } from "./lib.js";

const DEFAULT_BASE_URL = "https://integrate.api.nvidia.com/v1";
const DEFAULT_MODEL = "meta/llama-3.3-70b-instruct";

/**
 * Ask an NVIDIA-hosted model (OpenAI-compatible chat completions API) to explain a phrase.
 * temperature is pinned to 0: these are factual definitions, and creativity is a bug.
 */
export async function explainWithNvidia(phrase, env) {
  const baseUrl = (env.NVIDIA_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, "");
  const model = env.NVIDIA_MODEL || DEFAULT_MODEL;

  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.NVIDIA_API_KEY}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: userMessage(phrase) },
      ],
      temperature: 0,
      top_p: 1,
      max_tokens: 700,
      stream: false,
    }),
    signal: AbortSignal.timeout(25_000),
  });

  if (!res.ok) {
    // Don't echo the upstream body: it can include the prompt, which includes user text.
    throw new Error(`NVIDIA API returned HTTP ${res.status}`);
  }

  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content;
  const result = sanitizeExplanation(extractJson(content));
  if (!result) throw new Error("Model reply was not valid JSON");
  return { ...result, model };
}
