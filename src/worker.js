import {
  MAX_INPUT_CHARS,
  fleschKincaidGrade,
  isLoggableTerm,
  looksPersonal,
  normalizePhrase,
} from "./lib.js";
import { PROMPT_VERSION } from "./prompt.js";
import { explainWithNvidia, modelList, requestBody } from "./nvidia.js";
import { getCachedExplanation, recordSearch, supabaseConfigured, topTerms } from "./supabase.js";
import { DEMO_EXPLANATIONS } from "./demo.js";

const GLOSSARY_CACHE_SECONDS = 60;

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

const errorResponse = (status, error, message) => json({ error, message }, status);

function present(result, source, logged) {
  return {
    term: result.term,
    understood: result.understood,
    explanation: result.explanation,
    word_parts: result.word_parts,
    questions: result.questions,
    reading_grade: result.understood ? fleschKincaidGrade(result.explanation) : null,
    source, // "ai" | "glossary" | "demo"
    logged, // whether the term was counted in the public glossary
  };
}

// Logging must never break or slow down the user's answer.
function logInBackground(ctx, env, entry) {
  if (!supabaseConfigured(env) || !isLoggableTerm(entry.term)) return false;
  ctx.waitUntil(recordSearch(env, entry).catch((err) => console.error(err.message)));
  return true;
}

async function handleExplain(request, env, ctx) {
  if (env.EXPLAIN_LIMITER) {
    // Rate-limit counters live in Cloudflare memory only; the IP is never stored or logged.
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.EXPLAIN_LIMITER.limit({ key: ip });
    if (!success) return errorResponse(429, "rate_limited", "Too many requests. Please wait a minute and try again.");
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse(400, "bad_request", "Send JSON like {\"phrase\": \"...\"}.");
  }
  const phrase = typeof body?.phrase === "string" ? body.phrase.replace(/\s+/g, " ").trim() : "";
  if (phrase.length < 2) return errorResponse(400, "bad_request", "Please enter a word or phrase.");
  if (phrase.length > MAX_INPUT_CHARS) {
    return errorResponse(400, "too_long", `Please paste a shorter phrase (up to ${MAX_INPUT_CHARS} characters).`);
  }

  const key = normalizePhrase(phrase);
  const keyIsTerm = isLoggableTerm(key) && !looksPersonal(phrase);

  // 1. Same term asked before under the same prompt: reuse the stored answer.
  //    With temperature 0 the model would say the same thing anyway; this makes it guaranteed.
  if (keyIsTerm && supabaseConfigured(env)) {
    try {
      const cached = await getCachedExplanation(env, key, PROMPT_VERSION);
      if (cached?.explanation) {
        const logged = logInBackground(ctx, env, { term: key });
        return json(present(cached.explanation, "glossary", logged));
      }
    } catch (err) {
      console.error(err.message); // fall through to the model
    }
  }

  // 2. No AI configured yet: serve the built-in examples.
  if (!env.NVIDIA_API_KEY) {
    const demo = DEMO_EXPLANATIONS[key];
    if (!demo) {
      return errorResponse(
        503,
        "demo_mode",
        `The AI is not connected yet. Try one of the examples: ${Object.keys(DEMO_EXPLANATIONS).join(", ")}.`,
      );
    }
    const logged = logInBackground(ctx, env, { term: demo.term });
    return json(present(demo, "demo", logged));
  }

  // 3. Ask the model.
  let result;
  try {
    result = await explainWithNvidia(phrase, env);
  } catch (err) {
    console.error(err.message);
    return errorResponse(502, "upstream_error", "We couldn't get an explanation right now. Please try again.");
  }

  if (!result.understood) return json(present(result, "ai", false));

  // Only store the explanation when it describes exactly the glossary term and
  // nothing personal; otherwise just count the term.
  const storeExplanation = result.term === key && keyIsTerm && !result.has_personal_info;
  const { model, reasoning_used, ...stored } = result;
  const logged = logInBackground(ctx, env, {
    term: result.term,
    explanation: storeExplanation ? stored : null,
    model: storeExplanation ? model : null,
    promptVersion: storeExplanation ? PROMPT_VERSION : null,
  });
  return json(present(result, "ai", logged));
}

async function handleGlossary(request, env, ctx) {
  if (!supabaseConfigured(env)) return json({ configured: false, terms: [] });

  const cache = caches.default;
  const cacheKey = new Request(new URL("/api/glossary", request.url).toString());
  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  try {
    const terms = await topTerms(env, 50);
    const res = json({ configured: true, terms }, 200, {
      "Cache-Control": `public, max-age=${GLOSSARY_CACHE_SECONDS}`,
    });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    console.error(err.message);
    return errorResponse(502, "upstream_error", "The glossary is unavailable right now.");
  }
}

// Makes one real model call with a fixed test word (never user input) and reports
// NVIDIA's exact error and timing, so problems can be diagnosed from a browser.
async function handleAiCheck(request, env) {
  if (!env.NVIDIA_API_KEY) return json({ ok: false, error: "NVIDIA_API_KEY is not set." });
  if (env.EXPLAIN_LIMITER) {
    const ip = request.headers.get("CF-Connecting-IP") || "unknown";
    const { success } = await env.EXPLAIN_LIMITER.limit({ key: ip });
    if (!success) return errorResponse(429, "rate_limited", "Too many requests. Please wait a minute and try again.");
  }
  const reasoning = env.NVIDIA_REASONING !== "off";
  const models = modelList(env);
  const { messages, model, ...sent } = requestBody("cardiomegaly", env, models[0], reasoning);
  const settings = { test_word: "cardiomegaly", models_in_order: models, settings_sent: sent };
  const started = Date.now();
  try {
    const result = await explainWithNvidia("cardiomegaly", env);
    return json({
      ok: true,
      seconds: (Date.now() - started) / 1000,
      ...settings,
      model_used: result.model,
      reasoning_used: result.reasoning_used,
      answer: result.explanation,
    });
  } catch (err) {
    return json({ ok: false, seconds: (Date.now() - started) / 1000, ...settings, error: err.message });
  }
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (pathname === "/api/explain") {
      if (request.method !== "POST") return errorResponse(405, "method_not_allowed", "Use POST.");
      return handleExplain(request, env, ctx);
    }
    if (pathname === "/api/glossary") {
      if (request.method !== "GET") return errorResponse(405, "method_not_allowed", "Use GET.");
      return handleGlossary(request, env, ctx);
    }
    if (pathname === "/api/health/ai") return handleAiCheck(request, env);
    if (pathname === "/api/health") {
      return json({
        ai: Boolean(env.NVIDIA_API_KEY),
        glossary: supabaseConfigured(env),
        temperature: 0,
        prompt_version: PROMPT_VERSION,
      });
    }
    if (pathname.startsWith("/api/")) return errorResponse(404, "not_found", "Unknown API route.");

    return env.ASSETS.fetch(request);
  },
};
