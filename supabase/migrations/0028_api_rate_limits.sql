-- FaithForm: API rate limiting (service role only)
-- Migration 0028

create table if not exists public.api_rate_limits (
  rate_key text primary key,
  window_start timestamptz not null,
  hit_count int not null default 0
);

alter table public.api_rate_limits enable row level security;

-- No policies: accessed only via service role from server routes
