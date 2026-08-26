-- Minimal Supabase surface for the attendance concurrency harness.
--
-- This is NOT a migration rehearsal. It creates only what migrations 0055 and
-- 0056 depend on — the roles, the `auth` schema, and the handful of Prompt 1/3
-- tables the attendance authority references — so a plain Postgres can execute
-- and observe the attendance functions.
--
-- A real rehearsal applies every migration in order against a Supabase project
-- and is a separate, still-pending gate. See
-- P6_LEGACY_MIGRATION_AND_RECONCILIATION.md.

create extension if not exists pgcrypto;

-- Supabase's roles. The migrations revoke from and grant to these by name.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end $$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text
);

-- RLS helpers the policies call. Returning null is correct here: this harness
-- connects as a superuser and exercises the functions, not the policies.
create or replace function auth.uid() returns uuid language sql stable as $$ select null::uuid $$;

-- ---------------------------------------------------------------------------
-- Prompt 1 / 3 tables the attendance authority references
-- ---------------------------------------------------------------------------

create table if not exists public.churches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  timezone text not null default 'America/New_York',
  is_discoverable boolean not null default false,
  join_policy text not null default 'approval_required',
  created_at timestamptz not null default now()
);

create table if not exists public.church_users (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null default 'admin',
  unique (church_id, user_id)
);

create table if not exists public.members (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  phone text,
  email text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.church_campuses (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  name text not null,
  slug text not null,
  latitude numeric(9, 6),
  longitude numeric(9, 6),
  timezone text not null default 'America/New_York',
  geofence_radius_m integer not null default 150,
  is_active boolean not null default true,
  is_public boolean not null default true,
  is_primary boolean not null default false,
  sort_key integer not null default 0,
  updated_at timestamptz not null default now(),
  unique (church_id, slug)
);

create table if not exists public.church_service_times (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  campus_id uuid references public.church_campuses (id) on delete set null,
  label text not null,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time,
  kind text not null default 'regular',
  sort_order integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.visitor_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,
  auto_attendance_consent text not null default 'unset',
  authorization_version integer not null default 1,
  status text not null default 'active',
  selected_church_id uuid references public.churches (id) on delete set null
);

create table if not exists public.visitor_church_relationships (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.visitor_accounts (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  state text not null default 'following',
  unique (account_id, church_id)
);

create table if not exists public.visitor_people_links (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.visitor_accounts (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  is_active boolean not null default true
);

-- The two RLS helpers 0055's policies reference.
create or replace function public.is_church_staff(target_church_id uuid)
returns boolean language sql stable as $$ select false $$;

create or replace function public.current_visitor_account_id()
returns uuid language sql stable as $$ select null::uuid $$;

-- ---------------------------------------------------------------------------
-- Legacy attendance
-- ---------------------------------------------------------------------------
--
-- The pre-Faithful model, created empty so a test can prove the new authority
-- never writes to it. Prompt 6 asserts this by source inspection; with the
-- tables present it can be *observed* — count before, count after, compare.
--
-- Deliberately minimal: only the columns a "was anything written" check needs.
-- This is not a schema rehearsal, and the real tables have more.

create table if not exists public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches(id) on delete cascade,
  service_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.attendance_entries (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.attendance_records(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  status text not null default 'present'
);

-- ---------------------------------------------------------------------------
-- Streaming surface (Prompt 9)
-- ---------------------------------------------------------------------------
--
-- The minimum of migrations 0032/0033/0034/0047 that migration 0060 references.
-- Column names and types match those migrations exactly; anything 0060 does not
-- touch is omitted, because a fixture that drifts towards being a second copy
-- of the schema is a fixture that will disagree with it.

create or replace function public.user_church_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select church_id from public.church_users where user_id = auth.uid()
$$;

create table if not exists public.stream_sessions (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  status text not null
    check (status in ('preparing', 'waiting_for_encoder', 'live', 'ended', 'error')),
  title text,
  started_by uuid references auth.users (id) on delete set null,
  ingest_started_at timestamptz,
  live_started_at timestamptz,
  ended_at timestamptz,
  stream_event_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stream_events (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  recurrence_rule text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'live', 'ended', 'cancelled')),
  artwork_url text,
  chat_enabled boolean not null default false,
  countdown_enabled boolean not null default true,
  public_access boolean not null default true,
  simulated boolean not null default false,
  stream_session_id uuid references public.stream_sessions (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_series (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.stream_recordings (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  stream_session_id uuid references public.stream_sessions (id) on delete set null,
  stream_event_id uuid references public.stream_events (id) on delete set null,
  title text,
  storage_path text not null,
  duration_sec numeric,
  status text not null default 'processing'
    check (status in ('processing', 'ready', 'published')),
  trim_start_sec numeric not null default 0,
  trim_end_sec numeric,
  published_at timestamptz,
  series_id uuid references public.media_series (id) on delete set null,
  visibility text not null default 'public'
    check (visibility in ('public', 'unlisted')),
  speaker_tags text[] not null default '{}',
  chapter_tags text[] not null default '{}',
  topic_tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.media_views (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  recording_id uuid references public.stream_recordings (id) on delete cascade,
  stream_session_id uuid references public.stream_sessions (id) on delete set null,
  kind text not null check (kind in ('live', 'replay')),
  source text not null default 'website'
    check (source in ('website', 'app', 'embed')),
  viewer_key text,
  idempotency_key text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- GIVING (Prompt 11)
-- ---------------------------------------------------------------------------
--
-- The shapes migrations 0013 and 0016 create in production, reduced to the
-- columns Faithful's giving path reads or writes. Deliberately *not* a copy of
-- the whole giving schema: statements, payouts, portal sessions and fee
-- breakdowns are dashboard concerns and nothing here touches them.
--
-- The Stripe readiness columns live on `churches` in production; they are added
-- here rather than in migration 0063, which must stay additive to a real
-- deployment where they already exist.

alter table public.churches
  add column if not exists stripe_account_id text,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false;

create table if not exists public.giving_funds (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  name text not null,
  slug text not null,
  sort_order integer not null default 0,
  is_default boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (church_id, slug)
);

create table if not exists public.giving_donors (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  email text not null,
  name text,
  stripe_customer_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (church_id, email)
);

create table if not exists public.giving_donations (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_invoice_id text,
  stripe_subscription_id text,
  stripe_object_key text,
  stripe_event_created_at timestamptz,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'refunded', 'disputed')),
  gift_type text not null default 'one_time'
    check (gift_type in ('one_time', 'recurring')),
  donor_name text,
  donor_email text,
  fund_designation text,
  fund_id uuid references public.giving_funds (id) on delete set null,
  donor_id uuid references public.giving_donors (id) on delete set null,
  intended_amount_cents integer,
  fee_covered boolean not null default false,
  stripe_fee_cents integer,
  net_amount_cents integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists giving_donations_stripe_pi_key
  on public.giving_donations (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
