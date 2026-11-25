-- Migration 0183: A church's monthly rate is shown only once FaithForm confirms it
--
-- Every church pays its own agreed amount. Migration 0181 defaulted the rate to
-- $250, so a church's Billing tab could show $250 a month before anyone had
-- agreed a price with that church, and a new invoice was prefilled with it.
--
-- From here:
--
--   church_billing_profiles.monthly_rate_cents
--       the confirmed rate, or NULL. No default. Nothing church-facing shows
--       an amount while it is NULL, and no invoice can be issued.
--   church_billing_profiles.monthly_rate_confirmed_at / _by
--       who confirmed it and when, set together with the rate (checked below).
--   church_billing_rate_drafts
--       a rate entered before confirmation, kept only so a platform admin can
--       confirm it in one step. Service role only: church admins, who can read
--       their own church_billing_profiles row, cannot read this table.
--
-- Existing rows are treated as unconfirmed: whatever rate they hold (the $250
-- default or a value typed in) moves to church_billing_rate_drafts and must be
-- confirmed in the admin panel. Issued invoices are not touched; their amounts
-- were frozen when they were issued.
--
-- Idempotent: a rerun does not touch confirmed rows. Rollback: copy drafts
-- back into monthly_rate_cents, restore the default and NOT NULL, drop the
-- new columns and table.

create table if not exists public.church_billing_rate_drafts (
  church_id uuid primary key references public.churches (id) on delete cascade,
  proposed_monthly_rate_cents integer not null
    constraint church_billing_rate_drafts_rate_check
    check (proposed_monthly_rate_cents between 0 and 10000000),
  updated_at timestamptz not null default now()
);

alter table public.church_billing_rate_drafts enable row level security;
revoke all on table public.church_billing_rate_drafts from public, anon, authenticated;
grant all on table public.church_billing_rate_drafts to service_role;

alter table public.church_billing_profiles
  add column if not exists monthly_rate_confirmed_at timestamptz,
  add column if not exists monthly_rate_confirmed_by uuid references auth.users (id) on delete set null;

alter table public.church_billing_profiles
  alter column monthly_rate_cents drop default,
  alter column monthly_rate_cents drop not null;

insert into public.church_billing_rate_drafts (church_id, proposed_monthly_rate_cents)
select church_id, monthly_rate_cents
from public.church_billing_profiles
where monthly_rate_confirmed_at is null
  and monthly_rate_cents is not null
on conflict (church_id) do nothing;

update public.church_billing_profiles
set monthly_rate_cents = null
where monthly_rate_confirmed_at is null
  and monthly_rate_cents is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'church_billing_profiles_rate_confirmed_check'
  ) then
    alter table public.church_billing_profiles
      add constraint church_billing_profiles_rate_confirmed_check
      check ((monthly_rate_cents is null) = (monthly_rate_confirmed_at is null));
  end if;
end $$;
