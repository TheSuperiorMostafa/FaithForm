-- FaithForm: Giving enhancements — funds, donors, fees, portal sessions
-- Migration 0016

-- ---------------------------------------------------------------------------
-- CHURCHES: statement / tax fields
-- ---------------------------------------------------------------------------

alter table public.churches
  add column if not exists ein text,
  add column if not exists statement_address text;

-- ---------------------------------------------------------------------------
-- GIVING FUNDS
-- ---------------------------------------------------------------------------

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

create index if not exists giving_funds_church_idx
  on public.giving_funds (church_id, sort_order);

-- ---------------------------------------------------------------------------
-- GIVING DONORS
-- ---------------------------------------------------------------------------

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

create index if not exists giving_donors_church_idx
  on public.giving_donors (church_id);

-- ---------------------------------------------------------------------------
-- GIVING DONATIONS: extended columns
-- ---------------------------------------------------------------------------

alter table public.giving_donations
  add column if not exists fund_id uuid references public.giving_funds (id) on delete set null,
  add column if not exists donor_id uuid references public.giving_donors (id) on delete set null,
  add column if not exists intended_amount_cents integer,
  add column if not exists fee_covered boolean not null default false,
  add column if not exists stripe_fee_cents integer,
  add column if not exists net_amount_cents integer,
  add column if not exists refund_reason text;

create index if not exists giving_donations_church_status_idx
  on public.giving_donations (church_id, status);

create index if not exists giving_donations_church_fund_idx
  on public.giving_donations (church_id, fund_id);

create index if not exists giving_donations_donor_idx
  on public.giving_donations (donor_id);

-- ---------------------------------------------------------------------------
-- GIVING SUBSCRIPTIONS: extended columns
-- ---------------------------------------------------------------------------

alter table public.giving_subscriptions
  add column if not exists fund_id uuid references public.giving_funds (id) on delete set null,
  add column if not exists donor_id uuid references public.giving_donors (id) on delete set null,
  add column if not exists paused_at timestamptz,
  add column if not exists last_dunning_email_at timestamptz;

-- ---------------------------------------------------------------------------
-- DONOR PORTAL SESSIONS
-- ---------------------------------------------------------------------------

create table if not exists public.donor_portal_sessions (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  donor_id uuid not null references public.giving_donors (id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists donor_portal_sessions_donor_idx
  on public.donor_portal_sessions (donor_id);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.giving_funds enable row level security;
alter table public.giving_donors enable row level security;
alter table public.donor_portal_sessions enable row level security;

create policy "giving_funds_select"
  on public.giving_funds
  for select
  to authenticated
  using (church_id in (select public.user_church_ids()));

create policy "giving_donors_select"
  on public.giving_donors
  for select
  to authenticated
  using (church_id in (select public.user_church_ids()));

-- ---------------------------------------------------------------------------
-- SEED DEFAULT FUNDS + BACKFILL
-- ---------------------------------------------------------------------------

insert into public.giving_funds (church_id, name, slug, sort_order, is_default, is_active)
select c.id, f.name, f.slug, f.sort_order, f.is_default, true
from public.churches c
cross join (
  values
    ('General', 'general', 0, true),
    ('Missions', 'missions', 1, false),
    ('Building', 'building', 2, false)
) as f(name, slug, sort_order, is_default)
where not exists (
  select 1 from public.giving_funds gf where gf.church_id = c.id
);

insert into public.giving_donors (church_id, email, name, updated_at)
select distinct
  d.church_id,
  lower(trim(d.donor_email)),
  max(d.donor_name),
  now()
from public.giving_donations d
where d.donor_email is not null
  and trim(d.donor_email) <> ''
  and d.status = 'succeeded'
group by d.church_id, lower(trim(d.donor_email))
on conflict (church_id, email) do update
  set name = coalesce(excluded.name, giving_donors.name),
      updated_at = now();

update public.giving_donations d
set donor_id = gd.id
from public.giving_donors gd
where d.church_id = gd.church_id
  and lower(trim(d.donor_email)) = gd.email
  and d.donor_id is null
  and d.donor_email is not null;

update public.giving_donations d
set fund_id = gf.id
from public.giving_funds gf
where d.church_id = gf.church_id
  and gf.is_default = true
  and d.fund_id is null;
