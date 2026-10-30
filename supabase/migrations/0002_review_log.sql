-- Private review log for admins: one row per AI review, so the writer and reviewer
-- models can be assessed. Visitors never see this, and the public can't read it.
-- Like the glossary, it has no column for who searched, their IP, or what they typed.

create table if not exists public.review_log (
  id             bigint generated always as identity primary key,
  created_at     timestamptz not null default now(),
  term           text,        -- the general medical term; null if it couldn't be logged safely
  outcome        text not null
                 check (outcome in ('approved', 'corrected', 'failed', 'skipped', 'not_understood')),
  failed_rules   text[] not null default '{}',  -- e.g. {1,3}: which of the five rules the draft broke
  notes          jsonb,       -- the reviewer's notes; null when the input had personal details
  writer_model   text,
  reviewer_model text,
  prompt_version integer,
  seconds        numeric      -- how long the writer + reviewer took
);

create index if not exists review_log_created_at_idx on public.review_log (created_at desc);

-- Row-level security on, with no policies: the public (anon) and signed-in users can
-- neither read nor write. Only the server's secret key (service_role) can, and admins
-- read it in Supabase's Table Editor.
alter table public.review_log enable row level security;
revoke all on public.review_log from public, anon, authenticated;
grant select, insert on public.review_log to service_role;
