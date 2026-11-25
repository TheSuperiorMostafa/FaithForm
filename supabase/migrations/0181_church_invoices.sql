-- Migration 0181: Church billing (monthly invoices)
--
-- FaithForm bills each church a monthly retainer by invoice. Nothing here
-- moves money: there is no card, bank or Stripe state. A platform admin issues
-- an invoice for a month, marks it paid when payment arrives, or voids it.
--
--   church_billing_profiles   one row per church: monthly rate and the billing
--                             contact used to prefill the next invoice
--   church_invoices           one row per issued invoice, with the line items
--                             and the billed-to block frozen at issue time
--
-- ## Access
--
-- Church admins read their own church's rows through RLS (the same people who
-- see Settings > Billing). No browser role writes: every change is a platform
-- admin server action (app/admin/billing-actions.ts) that checks the caller and
-- then writes with the service role. The invoice PDF route authorises the
-- caller server-side before rendering.
--
-- Additive and idempotent. No existing table is altered. Rollback is dropping
-- these two tables and the sequence; invoices are financial records, so take
-- a copy first.

-- ---------------------------------------------------------------------------
-- INVOICE NUMBERS: FFT-1001, FFT-1002, ...
-- ---------------------------------------------------------------------------

create sequence if not exists public.church_invoice_number_seq
  as bigint
  start with 1001
  minvalue 1001;

-- ---------------------------------------------------------------------------
-- BILLING PROFILE
-- ---------------------------------------------------------------------------

create table if not exists public.church_billing_profiles (
  church_id uuid primary key references public.churches (id) on delete cascade,
  monthly_rate_cents integer not null default 25000
    constraint church_billing_profiles_rate_check
    check (monthly_rate_cents between 0 and 10000000),
  contact_name text
    constraint church_billing_profiles_contact_name_check
    check (contact_name is null or char_length(contact_name) <= 160),
  contact_email text
    constraint church_billing_profiles_contact_email_check
    check (contact_email is null or char_length(contact_email) <= 254),
  contact_phone text
    constraint church_billing_profiles_contact_phone_check
    check (contact_phone is null or char_length(contact_phone) <= 40),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null
);

-- ---------------------------------------------------------------------------
-- INVOICES
-- ---------------------------------------------------------------------------

create table if not exists public.church_invoices (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  invoice_number text not null
    default ('FFT-' || nextval('public.church_invoice_number_seq')::text)
    constraint church_invoices_number_key unique
    constraint church_invoices_number_check check (invoice_number ~ '^FFT-[0-9]{4,}$'),
  invoice_date date not null default current_date,
  -- The first day of the month this invoice covers.
  period_start date not null
    constraint church_invoices_period_start_check
    check (extract(day from period_start) = 1),
  status text not null default 'due'
    constraint church_invoices_status_check
    check (status in ('due', 'paid', 'void')),
  paid_at timestamptz,
  voided_at timestamptz,
  -- [{ "description", "detail", "qty", "unit_cents" (null = Included) }]
  line_items jsonb not null
    constraint church_invoices_line_items_check
    check (
      jsonb_typeof(line_items) = 'array'
      and jsonb_array_length(line_items) between 1 and 20
    ),
  subtotal_cents integer not null
    constraint church_invoices_subtotal_check check (subtotal_cents between 0 and 100000000),
  -- Churches are tax exempt, so the total is the subtotal. Kept separate so a
  -- later tax or discount does not need a schema change.
  total_cents integer not null
    constraint church_invoices_total_check check (total_cents between 0 and 100000000),
  -- { "organization", "contact_name", "email", "phone" } as printed.
  billed_to jsonb not null
    constraint church_invoices_billed_to_check check (jsonb_typeof(billed_to) = 'object'),
  notes text
    constraint church_invoices_notes_check check (notes is null or char_length(notes) <= 2000),
  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,
  constraint church_invoices_paid_state_check
    check ((status = 'paid') = (paid_at is not null)),
  constraint church_invoices_void_state_check
    check ((status = 'void') = (voided_at is not null))
);

-- One live invoice per church per month. A voided one can be reissued.
create unique index if not exists church_invoices_one_live_per_month
  on public.church_invoices (church_id, period_start)
  where status <> 'void';

-- Settings > Billing and the admin Billing tab list newest month first.
create index if not exists church_invoices_church_period_idx
  on public.church_invoices (church_id, period_start desc, created_at desc);

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------

alter table public.church_billing_profiles enable row level security;
alter table public.church_invoices enable row level security;

revoke all on public.church_billing_profiles from public, anon, authenticated;
revoke all on public.church_invoices from public, anon, authenticated;
grant select on public.church_billing_profiles to authenticated;
grant select on public.church_invoices to authenticated;
grant all on public.church_billing_profiles to service_role;
grant all on public.church_invoices to service_role;

revoke all on sequence public.church_invoice_number_seq from public, anon, authenticated;
grant usage, select on sequence public.church_invoice_number_seq to service_role;

drop policy if exists church_billing_profiles_admin_select on public.church_billing_profiles;
create policy church_billing_profiles_admin_select on public.church_billing_profiles
  for select to authenticated
  using (public.is_church_admin(church_id));

drop policy if exists church_invoices_admin_select on public.church_invoices;
create policy church_invoices_admin_select on public.church_invoices
  for select to authenticated
  using (public.is_church_admin(church_id));
