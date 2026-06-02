-- FaithForm: Stripe Connect giving
-- Migration 0013

-- ---------------------------------------------------------------------------
-- CHURCHES: slug + Stripe Connect state
-- ---------------------------------------------------------------------------

alter table public.churches
  add column if not exists slug text,
  add column if not exists stripe_account_id text,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false,
  add column if not exists stripe_onboarding_status text not null default 'not_started'
    check (
      stripe_onboarding_status in (
        'not_started',
        'pending',
        'restricted',
        'active',
        'deauthorized'
      )
    ),
  add column if not exists stripe_requirements_due jsonb not null default '[]'::jsonb,
  add column if not exists giving_enabled_at timestamptz;

-- Backfill slugs: name-based with id suffix for uniqueness
update public.churches
set slug = trim(
  both '-'
  from regexp_replace(
    lower(regexp_replace(coalesce(name, 'church'), '[^a-zA-Z0-9]+', '-', 'g')),
    '-+',
    '-',
    'g'
  )
) || '-' || left(replace(id::text, '-', ''), 8)
where slug is null;

alter table public.churches
  alter column slug set not null;

create unique index if not exists churches_slug_key on public.churches (slug);

create unique index if not exists churches_stripe_account_id_key
  on public.churches (stripe_account_id)
  where stripe_account_id is not null;

-- ---------------------------------------------------------------------------
-- GIVING DONATIONS
-- ---------------------------------------------------------------------------

create table public.giving_donations (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  stripe_payment_intent_id text,
  stripe_charge_id text,
  stripe_invoice_id text,
  stripe_subscription_id text,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  status text not null default 'pending'
    check (status in ('pending', 'succeeded', 'failed', 'refunded', 'disputed')),
  gift_type text not null default 'one_time'
    check (gift_type in ('one_time', 'recurring')),
  donor_name text,
  donor_email text,
  fund_designation text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index giving_donations_stripe_pi_key
  on public.giving_donations (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index giving_donations_church_created_idx
  on public.giving_donations (church_id, created_at desc);

-- ---------------------------------------------------------------------------
-- GIVING SUBSCRIPTIONS
-- ---------------------------------------------------------------------------

create table public.giving_subscriptions (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  stripe_subscription_id text not null unique,
  stripe_customer_id text not null,
  amount_cents integer not null check (amount_cents >= 0),
  currency text not null default 'usd',
  interval text not null check (interval in ('week', 'month', 'year')),
  status text not null default 'active'
    check (
      status in (
        'active',
        'past_due',
        'canceled',
        'incomplete',
        'incomplete_expired',
        'paused',
        'trialing',
        'unpaid'
      )
    ),
  donor_name text,
  donor_email text,
  fund_designation text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index giving_subscriptions_church_status_idx
  on public.giving_subscriptions (church_id, status);

-- ---------------------------------------------------------------------------
-- WEBHOOK IDEMPOTENCY
-- ---------------------------------------------------------------------------

create table public.stripe_webhook_events (
  event_id text primary key,
  event_type text not null,
  processed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

alter table public.giving_donations enable row level security;
alter table public.giving_subscriptions enable row level security;
alter table public.stripe_webhook_events enable row level security;

create policy "giving_donations_select"
  on public.giving_donations
  for select
  to authenticated
  using (church_id in (select public.user_church_ids()));

create policy "giving_subscriptions_select"
  on public.giving_subscriptions
  for select
  to authenticated
  using (church_id in (select public.user_church_ids()));
