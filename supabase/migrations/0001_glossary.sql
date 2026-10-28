-- Public glossary of searched medical terms.
-- Stores ONLY the term (plus its generated explanation and a counter).
-- There is deliberately no column for user, IP, session, user agent, or raw input.

create table if not exists public.glossary_terms (
  term              text primary key
                    check (char_length(term) between 2 and 80 and term = lower(term)),
  search_count      bigint      not null default 1 check (search_count > 0),
  explanation       jsonb,       -- cached model output for exactly this term (null until generated)
  model             text,        -- model that produced the explanation
  prompt_version    integer,     -- prompt that produced the explanation; mismatches are regenerated
  first_searched_at timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index if not exists glossary_terms_search_count_idx
  on public.glossary_terms (search_count desc);

-- Anyone may read the glossary; nobody but the server may write.
-- Explicit grants, in case the project doesn't auto-expose new tables to the Data API.
grant select on public.glossary_terms to anon, authenticated, service_role;
revoke insert, update, delete, truncate on public.glossary_terms from anon, authenticated;

alter table public.glossary_terms enable row level security;

drop policy if exists "Glossary is public" on public.glossary_terms;
create policy "Glossary is public"
  on public.glossary_terms for select
  to anon, authenticated
  using (true);

-- Atomic upsert + increment, called by the Cloudflare Worker with the service key.
-- Passing an explanation replaces the stored one (e.g. after a prompt change);
-- passing null just counts the search.
create or replace function public.record_search(
  p_term           text,
  p_explanation    jsonb   default null,
  p_model          text    default null,
  p_prompt_version integer default null
) returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.glossary_terms as g (term, explanation, model, prompt_version)
  values (lower(trim(p_term)), p_explanation, p_model, p_prompt_version)
  on conflict (term) do update set
    search_count   = g.search_count + 1,
    updated_at     = now(),
    explanation    = coalesce(excluded.explanation, g.explanation),
    model          = case when excluded.explanation is null then g.model else excluded.model end,
    prompt_version = case when excluded.explanation is null then g.prompt_version else excluded.prompt_version end;
$$;

revoke all on function public.record_search(text, jsonb, text, integer) from public, anon, authenticated;
grant execute on function public.record_search(text, jsonb, text, integer) to service_role;
