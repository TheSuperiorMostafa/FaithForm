-- Migration 0182: One Stripe connected account per fund
--
-- A church can now route a fund's gifts to that fund's own bank account. Stripe
-- pools every charge on one connected account into one balance and one bank,
-- so a separate bank means a separate Standard connected account.
--
--   giving_stripe_accounts          every connected account a church owns. The
--                                   church's existing account (churches.
--                                   stripe_account_id) is backfilled here as the
--                                   primary row.
--   giving_funds.giving_stripe_account_id
--                                   which account a fund's gifts go to. NULL
--                                   means the church's primary account, which is
--                                   what every fund means today, so no existing
--                                   fund changes where its money goes.
--   giving_funds.pending_giving_stripe_account_id
--                                   the account an existing fund moves to once
--                                   that account is active.
--   giving_donor_stripe_customers   a donor's Stripe Customer on each account.
--                                   Customers, saved cards and subscriptions
--                                   never cross accounts.
--   giving_payouts                  payouts per account, for the Funds & Banks
--                                   view and reconciliation.
--   stripe_account_id (text, acct_…) on donations, subscriptions and mobile
--                                   attempts: the account that took the money,
--                                   so refunds, cancellations and resumes go to
--                                   the right place. Backfilled from the church.
--
-- ## Privacy
--
-- No bank account number, routing number or EIN is stored. A bank is a display
-- name and its last four digits, nothing more.
--
-- ## Access
--
-- Church admins read their own church's accounts and payouts through RLS. No
-- browser role writes: account creation, webhook sync and fund routing changes
-- go through server code that checks the caller and writes with the service
-- role.
--
-- ## Rollout
--
-- Additive and idempotent. Application code from before this migration keeps
-- working: it still reads churches.stripe_account_id, which is unchanged. The
-- backfills only fill NULLs. Rollback is dropping the new tables and columns
-- after moving any non-primary fund back to NULL; take a copy of
-- giving_payouts first, it is a financial record.

-- ---------------------------------------------------------------------------
-- CONNECTED ACCOUNTS
-- ---------------------------------------------------------------------------

create table if not exists public.giving_stripe_accounts (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  stripe_account_id text not null
    constraint giving_stripe_accounts_acct_check
      check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  label text not null
    constraint giving_stripe_accounts_label_check
      check (btrim(label) <> '' and char_length(label) <= 120),
  is_primary boolean not null default false,

  -- Display only. Never a full account or routing number.
  bank_name text
    constraint giving_stripe_accounts_bank_name_check
      check (bank_name is null or char_length(bank_name) <= 120),
  bank_last4 text
    constraint giving_stripe_accounts_bank_last4_check
      check (bank_last4 is null or bank_last4 ~ '^[0-9]{4}$'),
  bank_source text
    constraint giving_stripe_accounts_bank_source_check
      check (bank_source is null or bank_source in ('payout', 'external_account', 'admin')),

  status text not null default 'pending'
    constraint giving_stripe_accounts_status_check
      check (status in ('pending', 'restricted', 'active', 'deauthorized')),
  details_submitted boolean not null default false,
  charges_enabled boolean not null default false,
  payouts_enabled boolean not null default false,
  requirements_due jsonb not null default '[]'::jsonb,
  payout_schedule jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint giving_stripe_accounts_acct_key unique (stripe_account_id),
  -- Lets funds reference (church_id, id) so a fund can only ever point at an
  -- account of its own church.
  constraint giving_stripe_accounts_church_id_key unique (church_id, id)
);

create unique index if not exists giving_stripe_accounts_one_primary
  on public.giving_stripe_accounts (church_id)
  where is_primary;

create index if not exists giving_stripe_accounts_church_idx
  on public.giving_stripe_accounts (church_id, created_at);

-- The church's existing account becomes its primary row.
insert into public.giving_stripe_accounts (
  church_id, stripe_account_id, label, is_primary, status,
  details_submitted, charges_enabled, payouts_enabled, requirements_due
)
select
  c.id,
  c.stripe_account_id,
  'Main account',
  true,
  case
    when c.stripe_onboarding_status in ('pending', 'restricted', 'active', 'deauthorized')
      then c.stripe_onboarding_status
    else 'pending'
  end,
  c.stripe_details_submitted,
  c.stripe_charges_enabled,
  c.stripe_payouts_enabled,
  coalesce(c.stripe_requirements_due, '[]'::jsonb)
from public.churches c
where c.stripe_account_id is not null
  and c.stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
on conflict (stripe_account_id) do nothing;

-- ---------------------------------------------------------------------------
-- FUND ROUTING
-- ---------------------------------------------------------------------------

alter table public.giving_funds
  add column if not exists giving_stripe_account_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'giving_funds_stripe_account_fkey'
  ) then
    -- Composite, so a fund cannot point at another church's account. RESTRICT,
    -- not SET NULL: silently sending a fund's money to the primary bank when its
    -- account row disappears is the one failure this feature must never have.
    alter table public.giving_funds
      add constraint giving_funds_stripe_account_fkey
      foreign key (church_id, giving_stripe_account_id)
      references public.giving_stripe_accounts (church_id, id)
      on delete restrict;
  end if;
end $$;

-- An existing fund moving to a new account keeps taking gifts on its current
-- account until the new one can charge and pay out; then the switch happens.
alter table public.giving_funds
  add column if not exists pending_giving_stripe_account_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'giving_funds_pending_stripe_account_fkey'
  ) then
    alter table public.giving_funds
      add constraint giving_funds_pending_stripe_account_fkey
      foreign key (church_id, pending_giving_stripe_account_id)
      references public.giving_stripe_accounts (church_id, id)
      on delete restrict;
  end if;
end $$;

create index if not exists giving_funds_stripe_account_idx
  on public.giving_funds (giving_stripe_account_id)
  where giving_stripe_account_id is not null;

-- ---------------------------------------------------------------------------
-- WHICH ACCOUNT TOOK THE MONEY
-- ---------------------------------------------------------------------------

alter table public.giving_donations
  add column if not exists stripe_account_id text;
alter table public.giving_subscriptions
  add column if not exists stripe_account_id text;
alter table public.giving_donation_attempts
  add column if not exists stripe_account_id text;
alter table public.giving_recurring_attempts
  add column if not exists stripe_account_id text;

-- Offline gifts (migration 0144) have no Stripe charge, so only rows with a
-- Stripe id are backfilled.
update public.giving_donations d
set stripe_account_id = c.stripe_account_id
from public.churches c
where c.id = d.church_id
  and d.stripe_account_id is null
  and c.stripe_account_id is not null
  and (d.stripe_payment_intent_id is not null
       or d.stripe_invoice_id is not null
       or d.stripe_charge_id is not null);

update public.giving_subscriptions s
set stripe_account_id = c.stripe_account_id
from public.churches c
where c.id = s.church_id
  and s.stripe_account_id is null
  and c.stripe_account_id is not null;

update public.giving_donation_attempts a
set stripe_account_id = c.stripe_account_id
from public.churches c
where c.id = a.church_id
  and a.stripe_account_id is null
  and c.stripe_account_id is not null;

update public.giving_recurring_attempts a
set stripe_account_id = c.stripe_account_id
from public.churches c
where c.id = a.church_id
  and a.stripe_account_id is null
  and c.stripe_account_id is not null;

create index if not exists giving_donations_stripe_account_idx
  on public.giving_donations (church_id, stripe_account_id, created_at desc);
create index if not exists giving_subscriptions_stripe_account_idx
  on public.giving_subscriptions (stripe_account_id, stripe_subscription_id);

-- ---------------------------------------------------------------------------
-- DONOR CUSTOMERS PER ACCOUNT
-- ---------------------------------------------------------------------------

create table if not exists public.giving_donor_stripe_customers (
  donor_id uuid not null references public.giving_donors (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  stripe_account_id text not null
    constraint giving_donor_stripe_customers_acct_check
      check (stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  stripe_customer_id text not null
    constraint giving_donor_stripe_customers_cus_check
      check (stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (donor_id, stripe_account_id)
);

create index if not exists giving_donor_stripe_customers_church_idx
  on public.giving_donor_stripe_customers (church_id);

-- Existing customers all live on the church's primary account.
insert into public.giving_donor_stripe_customers (
  donor_id, church_id, stripe_account_id, stripe_customer_id
)
select d.id, d.church_id, c.stripe_account_id, d.stripe_customer_id
from public.giving_donors d
join public.churches c on c.id = d.church_id
where d.stripe_customer_id ~ '^cus_[A-Za-z0-9]+$'
  and c.stripe_account_id ~ '^acct_[A-Za-z0-9]+$'
on conflict (donor_id, stripe_account_id) do nothing;

-- ---------------------------------------------------------------------------
-- PAYOUTS
-- ---------------------------------------------------------------------------

create table if not exists public.giving_payouts (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  stripe_account_id text not null,
  stripe_payout_id text not null
    constraint giving_payouts_po_check
      check (stripe_payout_id ~ '^po_[A-Za-z0-9]+$'),
  amount_cents bigint not null,
  currency text not null default 'usd',
  status text not null
    constraint giving_payouts_status_check
      check (status in ('paid', 'pending', 'in_transit', 'canceled', 'failed')),
  arrival_date timestamptz,
  failure_code text,
  bank_name text
    constraint giving_payouts_bank_name_check
      check (bank_name is null or char_length(bank_name) <= 120),
  bank_last4 text
    constraint giving_payouts_bank_last4_check
      check (bank_last4 is null or bank_last4 ~ '^[0-9]{4}$'),
  stripe_event_created_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint giving_payouts_po_key unique (stripe_payout_id)
);

create index if not exists giving_payouts_account_idx
  on public.giving_payouts (church_id, stripe_account_id, arrival_date desc);

-- ---------------------------------------------------------------------------
-- MOBILE: only list a fund whose account can take money
-- ---------------------------------------------------------------------------
--
-- Same as migration 0131's definition plus one predicate: a fund routed to its
-- own account is listed only once that account can charge and pay out.

create or replace function public.mobile_giving_funds(
  p_church_slug text,
  p_relationship_state text
)
returns table (
  fund_id uuid,
  title text,
  description text,
  suggested_amounts integer[],
  min_amount_cents integer,
  max_amount_cents integer,
  currency text,
  sort_order integer,
  publication_version integer
)
language sql
security definer
stable
set search_path = public
as $$
  select
    f.id,
    coalesce(nullif(f.mobile_title, ''), f.name),
    nullif(f.mobile_description, ''),
    f.mobile_suggested_amounts,
    f.mobile_min_amount_cents,
    f.mobile_max_amount_cents,
    'usd'::text,
    f.sort_order,
    f.mobile_publication_version
  from public.giving_funds f
  join public.churches c on c.id = f.church_id
  where c.slug = p_church_slug
    and coalesce(p_relationship_state, 'none') <> 'blocked'
    and f.is_active
    and f.mobile_visibility <> 'none'
    and c.stripe_account_id is not null
    and c.stripe_charges_enabled
    and (
      f.giving_stripe_account_id is null
      or exists (
        select 1
        from public.giving_stripe_accounts a
        where a.id = f.giving_stripe_account_id
          and a.church_id = f.church_id
          and a.charges_enabled
          and a.payouts_enabled
          and a.status = 'active'
      )
    )
    and (
      f.mobile_visibility = 'public'
      or (f.mobile_visibility = 'followers'
          and p_relationship_state in ('following', 'joined'))
      or (f.mobile_visibility = 'members'
          and p_relationship_state = 'joined')
    )
  order by f.sort_order, f.id;
$$;
revoke all on function public.mobile_giving_funds(text, text)
  from public, anon, authenticated;
grant execute on function public.mobile_giving_funds(text, text) to service_role;

-- ---------------------------------------------------------------------------
-- RLS AND GRANTS
-- ---------------------------------------------------------------------------

alter table public.giving_stripe_accounts enable row level security;
alter table public.giving_donor_stripe_customers enable row level security;
alter table public.giving_payouts enable row level security;

drop policy if exists giving_stripe_accounts_admin_select on public.giving_stripe_accounts;
create policy giving_stripe_accounts_admin_select on public.giving_stripe_accounts
  for select to authenticated
  using (public.is_church_admin(church_id));

drop policy if exists giving_payouts_admin_select on public.giving_payouts;
create policy giving_payouts_admin_select on public.giving_payouts
  for select to authenticated
  using (public.is_church_admin(church_id));

-- Donor customer ids are read by server code only.
revoke all on public.giving_stripe_accounts from public, anon, authenticated;
revoke all on public.giving_donor_stripe_customers from public, anon, authenticated;
revoke all on public.giving_payouts from public, anon, authenticated;
grant select on public.giving_stripe_accounts to authenticated;
grant select on public.giving_payouts to authenticated;
grant all on public.giving_stripe_accounts to service_role;
grant all on public.giving_donor_stripe_customers to service_role;
grant all on public.giving_payouts to service_role;
