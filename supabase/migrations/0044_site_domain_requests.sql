-- FaithForm: church-initiated domain setup
-- Migration 0044
--
-- 0042 shipped `site_domains` as a bare hostname -> church mapping that a
-- platform admin inserted by hand, and left provisioning as "a later step".
-- This is that step, minus the assumption that we own a registrar API.
--
-- Two things a church can ask for:
--   1. connect_existing — they already own gracechurch.org and want it pointed
--      here. They can act immediately: we hand them DNS records and verify.
--   2. register_new     — they have no domain. We buy it and set it up with
--      them. There is nothing they can do alone, so this is purely a queue.
--
-- Both land in `site_domain_requests`, which is the control-center work queue.
-- `site_domains` stays what it always was: the routing table middleware reads.
-- A request produces a domain row; it never replaces one.
--
-- Why a domain is not "verified" the moment DNS resolves: this app is served by
-- Vercel, and Vercel will not answer for a hostname that has not been added to
-- the project. Correct DNS is necessary and not sufficient. So `status` tracks
-- both halves honestly — `dns_ok` means the church did their part, `live` means
-- ours is done too. Conflating them would show a church a green check on a
-- domain that serves nothing.

-- ---------------------------------------------------------------------------
-- SHARED TRIGGER (from 0042 — redeclared so this migration stands alone)
-- ---------------------------------------------------------------------------

create or replace function public.set_site_tables_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- SITE_DOMAINS: provisioning state
-- ---------------------------------------------------------------------------

alter table public.site_domains
  -- pending_dns → the church still has records to add
  -- dns_ok      → DNS resolves to us; waiting on the platform side
  -- live        → serving
  -- failed      → checked and wrong; `dns_detail` says what we saw
  add column if not exists status text not null default 'pending_dns',
  add column if not exists dns_checked_at timestamptz,
  -- Human-readable result of the last check, e.g. "CNAME points to
  -- ghs.googlehosted.com". Shown verbatim to the church, so it must never
  -- contain anything but resolver output.
  add column if not exists dns_detail text,
  -- 'manual' when a platform admin is doing the Vercel side by hand,
  -- 'vercel' when VERCEL_TOKEN is configured and the app did it.
  add column if not exists provider text not null default 'manual',
  add column if not exists provider_domain_id text,
  add column if not exists requested_by uuid references auth.users (id) on delete set null,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();

-- Added separately: a CHECK cannot be written with `if not exists`, and
-- re-running the migration must not fail on an already-present constraint.
do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'site_domains_status_check'
  ) then
    alter table public.site_domains
      add constraint site_domains_status_check
      check (status in ('pending_dns', 'dns_ok', 'live', 'failed'));
  end if;
end
$$;

-- Rows that predate this migration were inserted by hand and are already
-- serving, so an existing verified_at means live.
update public.site_domains
   set status = 'live'
 where verified_at is not null
   and status = 'pending_dns';

drop trigger if exists site_domains_updated_at on public.site_domains;
create trigger site_domains_updated_at
  before update on public.site_domains
  for each row execute function public.set_site_tables_updated_at();

-- ---------------------------------------------------------------------------
-- SITE_DOMAIN_REQUESTS  (the control-center queue)
-- ---------------------------------------------------------------------------

create table if not exists public.site_domain_requests (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,

  kind text not null check (kind in ('connect_existing', 'register_new')),

  -- connect_existing: the domain they own, normalised lowercase and bare.
  -- register_new: their first choice, which may well be unavailable.
  hostname text check (hostname is null or hostname = lower(hostname)),
  -- register_new only. Fallbacks, in preference order, so we can buy the best
  -- available one without a second round trip to the church.
  alternate_hostnames text[] not null default '{}',
  -- connect_existing only. Knowing it is GoDaddy vs Cloudflare is most of the
  -- support call.
  registrar text,

  contact_name text,
  contact_email text,
  contact_phone text,
  notes text,

  status text not null default 'submitted' check (
    status in (
      'submitted',      -- in the queue, untouched
      'in_review',      -- a platform admin picked it up
      'awaiting_church', -- blocked on them (DNS not added, name rejected, …)
      'in_progress',    -- we are actively setting it up
      'completed',      -- domain is live
      'declined',       -- we said no
      'cancelled'       -- the church withdrew it
    )
  ),
  admin_notes text,

  -- Set once the request produces a real routing row.
  domain_id uuid references public.site_domains (id) on delete set null,
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- "Connect the domain I own" is meaningless without the domain.
  constraint site_domain_requests_hostname_required check (
    kind <> 'connect_existing' or (hostname is not null and hostname <> '')
  )
);

create index if not exists site_domain_requests_church_id_idx
  on public.site_domain_requests (church_id, created_at desc);

-- The control center's default view is "everything still open, oldest first".
create index if not exists site_domain_requests_open_idx
  on public.site_domain_requests (created_at)
  where status in ('submitted', 'in_review', 'awaiting_church', 'in_progress');

-- One open request per church. Without this, a church that does not see an
-- immediate reply submits three times and the queue fills with duplicates of
-- the same conversation. Terminal statuses are excluded, so a church whose
-- request completed or was declined can always start a new one.
create unique index if not exists site_domain_requests_one_open_idx
  on public.site_domain_requests (church_id)
  where status in ('submitted', 'in_review', 'awaiting_church', 'in_progress');

drop trigger if exists site_domain_requests_updated_at on public.site_domain_requests;
create trigger site_domain_requests_updated_at
  before update on public.site_domain_requests
  for each row execute function public.set_site_tables_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Reads are church-scoped. Every write goes through a server action holding the
-- service-role client, because a hostname claim decides DNS routing for the
-- whole platform and status is our side of a conversation, not theirs. The
-- deliberate absence of insert/update policies is what stops a leaked anon key
-- from claiming someone else's domain.

alter table public.site_domain_requests enable row level security;

drop policy if exists site_domain_requests_select on public.site_domain_requests;
create policy site_domain_requests_select on public.site_domain_requests
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

notify pgrst, 'reload schema';
