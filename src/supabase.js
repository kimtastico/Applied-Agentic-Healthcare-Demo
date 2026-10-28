// Minimal Supabase REST (PostgREST) client using fetch, so the Worker needs no npm runtime deps.
// Only terms are stored. No IPs, user agents, session IDs, or raw user text are ever sent here.

export function supabaseConfigured(env) {
  return Boolean(env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY);
}

function headers(env) {
  const key = env.SUPABASE_SERVICE_KEY;
  const h = { apikey: key, "Content-Type": "application/json", Accept: "application/json" };
  // Legacy JWT keys also need a Bearer header; new sb_secret_ keys must not send one.
  if (!key.startsWith("sb_")) h.Authorization = `Bearer ${key}`;
  return h;
}

function restUrl(env, path) {
  return `${env.SUPABASE_URL.replace(/\/+$/, "")}/rest/v1/${path}`;
}

/** Look up a cached explanation for an exact glossary term. Returns null on miss. */
export async function getCachedExplanation(env, term, promptVersion) {
  const url = restUrl(
    env,
    `glossary_terms?select=explanation,model&term=eq.${encodeURIComponent(term)}` +
      `&prompt_version=eq.${promptVersion}&explanation=not.is.null&limit=1`,
  );
  const res = await fetch(url, { headers: headers(env), signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`Supabase lookup failed: HTTP ${res.status}`);
  const rows = await res.json();
  return rows[0] ?? null;
}

/**
 * Count one search for a term. Pass an explanation only when it describes exactly
 * this term (not a longer phrase that happened to contain it).
 */
export async function recordSearch(env, { term, explanation = null, model = null, promptVersion = null }) {
  const res = await fetch(restUrl(env, "rpc/record_search"), {
    method: "POST",
    headers: headers(env),
    body: JSON.stringify({
      p_term: term,
      p_explanation: explanation,
      p_model: model,
      p_prompt_version: promptVersion,
    }),
    signal: AbortSignal.timeout(5_000),
  });
  if (!res.ok) throw new Error(`Supabase record_search failed: HTTP ${res.status}`);
}

/** Most-searched terms for the public glossary. */
export async function topTerms(env, limit = 50) {
  const url = restUrl(
    env,
    `glossary_terms?select=term,search_count,explanation&order=search_count.desc,term.asc&limit=${limit}`,
  );
  const res = await fetch(url, { headers: headers(env), signal: AbortSignal.timeout(5_000) });
  if (!res.ok) throw new Error(`Supabase glossary query failed: HTTP ${res.status}`);
  const rows = await res.json();
  return rows.map((r) => ({
    term: r.term,
    count: r.search_count,
    summary: r.explanation?.explanation ?? null,
  }));
}
