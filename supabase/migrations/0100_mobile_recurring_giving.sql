-- Faithful: recurring giving from the phone
-- Migration 0100
--
-- Additive. One new table and four functions, and **not one change to an
-- existing table or column**. Nothing here writes a donation, a subscription
-- status, or an amount that money is charged against.
--
-- ## What already existed
--
-- Recurring giving, complete, on the web: `createConnectedSubscription` builds
-- a price and a subscription on the church's connected account, the donor
-- portal pauses, resumes, re-prices and cancels, and `lib/stripe/webhooks.ts`
-- reconciles every `customer.subscription.*` event onto
-- `public.giving_subscriptions`. Migration 0063 brought one-time giving to the
-- phone and, with `giving_donor_links`, the one thing that made it safe: a
-- mapping from a Faithful account to a church's donor row that is **not** an
-- email match.
--
-- ## What was missing
--
--   1. A phone could not start a recurring gift at all. `recurringAvailable`
--      on the giving home was a signpost to a web page, not a capability.
--   2. `claim_giving_attempt` protects a one-time gift from a double charge
--      across an app kill. A subscription had no equivalent, and a retried
--      create would have produced a second subscription — which is worse than a
--      second charge, because it keeps charging.
--   3. Nothing could answer "which recurring gifts are *mine*" for an account.
--      `giving_subscriptions` is keyed to a donor, and a donor is an email.
--
-- ## What is still true afterwards
--
-- The webhook remains the only authority on a subscription's status. The rows
-- written below record *what a person asked to start*; `giving_subscriptions`
-- records what Stripe says exists, and the projection at the bottom reads the
-- second through the first.

-- ---------------------------------------------------------------------------
-- RECURRING ATTEMPTS
-- ---------------------------------------------------------------------------

/*
 * A logical recurring-gift attempt: what a person is trying to start, before
 * Stripe knows anything about it.
 *
 * The same defence `giving_donation_attempts` provides for a one-time gift, and
 * it matters more here. A duplicated payment intent charges twice, once. A
 * duplicated subscription charges twice **every month**, and the second one is
 * invisible to the person who started it until their bank statement says so.
 *
 * `stripe_idempotency_key` is derived from the row, never from the client, so a
 * client cannot make two attempts share a key or one attempt use two.
 *
 * It is deliberately **not** a subscription. It carries no status of its own:
 * what became of it is read from `giving_subscriptions`, which only the webhook
 * writes.
 */
create table if not exists public.giving_recurring_attempts (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  account_id uuid not null references public.visitor_accounts (id) on delete cascade,
  fund_id uuid not null references public.giving_funds (id) on delete cascade,

  -- The client's own id for this attempt. Scoped to the account, so one
  -- person's id can never collide with another's.
  client_attempt_id text not null,

  -- Decided by the server from the fund and the church, never sent by a client.
  amount_cents integer not null check (amount_cents >= 100),
  currency text not null default 'usd',

  -- Constrained to what `giving_subscriptions.interval` already allows, so a
  -- phone cannot start a cadence the dashboard cannot render.
  interval text not null check (interval in ('week', 'month', 'year')),

  -- Derived from this row. Sent to Stripe so a network-level retry of the
  -- *same* attempt cannot create a second subscription even if this server
  -- retries.
  stripe_idempotency_key text not null,

  -- Write-once, via `attach_giving_subscription`.
  stripe_subscription_id text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (account_id, client_attempt_id)
);

create unique index if not exists giving_recurring_attempts_subscription_key
  on public.giving_recurring_attempts (stripe_subscription_id)
  where stripe_subscription_id is not null;

create index if not exists giving_recurring_attempts_account_idx
  on public.giving_recurring_attempts (account_id, church_id, created_at desc);

alter table public.giving_recurring_attempts enable row level security;

-- No policy is created, so PostgREST reaches nothing. Every read goes through a
-- `security definer` function below, which carries the account predicate.
revoke all on table public.giving_recurring_attempts from public, anon, authenticated;
grant select, insert, update on table public.giving_recurring_attempts to service_role;

-- ---------------------------------------------------------------------------
-- CLAIMING A RECURRING ATTEMPT
-- ---------------------------------------------------------------------------

/*
 * Reserves a logical recurring attempt, or returns the one that already exists.
 *
 * Mirrors `claim_giving_attempt` deliberately, including the order of its
 * checks: an attempt this account already started is returned **before** any
 * fund or amount check, because a retry must succeed even if the church
 * unpublished the fund or moved its bounds in between.
 */
create or replace function public.claim_giving_recurring_attempt(
  p_account_id uuid,
  p_church_id uuid,
  p_fund_id uuid,
  p_client_attempt_id text,
  p_amount_cents integer,
  p_interval text,
  p_currency text default 'usd',
  p_now timestamptz default now()
)
returns table (
  ok boolean,
  reason text,
  attempt_id uuid,
  created boolean,
  amount_cents integer,
  currency text,
  interval text,
  stripe_idempotency_key text,
  stripe_subscription_id text
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  fund record;
  existing record;
  inserted record;
begin
  if p_client_attempt_id is null or length(p_client_attempt_id) not between 8 and 64 then
    return query select false, 'invalid_attempt_id', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text;
    return;
  end if;

  if p_interval is null or p_interval not in ('week', 'month', 'year') then
    return query select false, 'invalid_interval', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text;
    return;
  end if;

  -- An attempt this account already started, returned before anything else.
  select a.* into existing
    from public.giving_recurring_attempts a
   where a.account_id = p_account_id
     and a.client_attempt_id = p_client_attempt_id;

  if found then
    if existing.church_id is distinct from p_church_id then
      -- The same id pointed at a different church. Not a retry; a bug or a
      -- tampered client, and either way it must not reuse the first attempt.
      return query select false, 'attempt_church_mismatch', null::uuid, false,
                          null::integer, null::text, null::text, null::text, null::text;
      return;
    end if;

    return query select true, 'existing', existing.id, false,
                        existing.amount_cents, existing.currency, existing.interval,
                        existing.stripe_idempotency_key, existing.stripe_subscription_id;
    return;
  end if;

  select f.* into fund
    from public.giving_funds f
   where f.id = p_fund_id
     and f.church_id = p_church_id;

  if not found then
    return query select false, 'fund_not_found', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text;
    return;
  end if;

  if fund.is_active is not true then
    return query select false, 'fund_inactive', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text;
    return;
  end if;

  if fund.mobile_visibility = 'none' then
    return query select false, 'fund_not_published', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text;
    return;
  end if;

  if p_amount_cents is null
     or p_amount_cents < fund.mobile_min_amount_cents
     or p_amount_cents > fund.mobile_max_amount_cents then
    return query select false, 'amount_out_of_range', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text;
    return;
  end if;

  insert into public.giving_recurring_attempts as a (
    church_id, account_id, fund_id, client_attempt_id,
    amount_cents, currency, interval, stripe_idempotency_key, created_at, updated_at
  )
  values (
    p_church_id, p_account_id, p_fund_id, p_client_attempt_id,
    p_amount_cents, coalesce(p_currency, 'usd'), p_interval,
    'ffr_' || replace(gen_random_uuid()::text, '-', ''),
    p_now, p_now
  )
  on conflict (account_id, client_attempt_id) do nothing
  returning a.* into inserted;

  if found then
    return query select true, 'created', inserted.id, true,
                        inserted.amount_cents, inserted.currency, inserted.interval,
                        inserted.stripe_idempotency_key, inserted.stripe_subscription_id;
    return;
  end if;

  -- Lost the insert race. Read the winner and reuse it rather than retrying.
  select a.* into existing
    from public.giving_recurring_attempts a
   where a.account_id = p_account_id
     and a.client_attempt_id = p_client_attempt_id;

  if not found then
    return query select false, 'attempt_unavailable', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text;
    return;
  end if;

  return query select true, 'existing', existing.id, false,
                      existing.amount_cents, existing.currency, existing.interval,
                      existing.stripe_idempotency_key, existing.stripe_subscription_id;
end;
$$;

revoke all on function public.claim_giving_recurring_attempt(
  uuid, uuid, uuid, text, integer, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_giving_recurring_attempt(
  uuid, uuid, uuid, text, integer, text, text, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- ATTACHING THE SUBSCRIPTION
-- ---------------------------------------------------------------------------

/*
 * Records the subscription an attempt became.
 *
 * Separate from the claim because the Stripe call happens between them, and a
 * function that spanned it would hold a transaction open across a network
 * request to another company.
 *
 * The `stripe_subscription_id is null` predicate makes it write-once: a second
 * call with a different id changes nothing, so a bug that created two
 * subscriptions cannot silently repoint the attempt at the second — it stays
 * pointed at the first, which is the one the person will be told about and the
 * one a support conversation can find.
 */
create or replace function public.attach_giving_subscription(
  p_attempt_id uuid,
  p_account_id uuid,
  p_subscription_id text,
  p_now timestamptz default now()
)
returns table (ok boolean, subscription_id text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  updated record;
  current record;
begin
  update public.giving_recurring_attempts a
     set stripe_subscription_id = p_subscription_id,
         updated_at = p_now
   where a.id = p_attempt_id
     and a.account_id = p_account_id
     and a.stripe_subscription_id is null
  returning a.* into updated;

  if found then
    return query select true, updated.stripe_subscription_id;
    return;
  end if;

  select a.* into current
    from public.giving_recurring_attempts a
   where a.id = p_attempt_id
     and a.account_id = p_account_id;

  if not found then
    return query select false, null::text;
    return;
  end if;

  -- Already attached. Reporting the id it already has, rather than the one
  -- this call brought, is what makes the write-once rule visible to the caller.
  return query select true, current.stripe_subscription_id;
end;
$$;

revoke all on function public.attach_giving_subscription(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.attach_giving_subscription(uuid, uuid, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- WHAT A PERSON'S RECURRING GIFTS ARE
-- ---------------------------------------------------------------------------

/*
 * One account's recurring gifts at one church.
 *
 * Ownership is `giving_donor_links` and nothing else — the mapping migration
 * 0063 created precisely so that an account is never matched to a church's
 * donor **by email**. The mobile create path establishes the link before it
 * creates the subscription, and the webhook writes `donor_id` onto the
 * subscription from its metadata, so the join below closes without either side
 * knowing about the other.
 *
 * Reading through the link rather than through a column of its own also means a
 * church that severs the link stops history, receipts and this list in one
 * action, as 0063 intended.
 *
 * What it does **not** return: the Stripe customer id, the provider's
 * subscription id, the donor's email or name, the fee, the net, and any other
 * subscription at the church. A phone gets what a person needs to recognise and
 * stop their own gift, and nothing that would identify anyone to anyone.
 */
create or replace function public.mobile_giving_recurring(
  p_account_id uuid,
  p_church_slug text
)
returns table (
  subscription_id uuid,
  fund_title text,
  amount_cents integer,
  currency text,
  interval text,
  status text,
  started_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with church as (
    select c.id from public.churches c where c.slug = p_church_slug
  ),
  linked_donor as (
    select l.donor_id
      from public.giving_donor_links l
      join church on church.id = l.church_id
     where l.account_id = p_account_id
       and l.revoked_at is null
  )
  select
    s.id,
    coalesce(
      nullif(btrim(f.mobile_title), ''),
      nullif(btrim(f.name), ''),
      nullif(btrim(s.fund_designation), ''),
      'Gift'
    ),
    s.amount_cents,
    s.currency,
    s.interval,
    s.status,
    s.created_at
  from public.giving_subscriptions s
  join church on church.id = s.church_id
  left join public.giving_funds f on f.id = s.fund_id
  where s.donor_id in (select donor_id from linked_donor)
    -- A cancelled gift is not shown. It charges nothing, there is nothing to
    -- do to it, and a list of dead gifts is not a thing a person came for.
    and s.status in ('active', 'trialing', 'past_due', 'paused', 'unpaid')
  order by s.created_at desc
  limit 50;
$$;

revoke all on function public.mobile_giving_recurring(uuid, text)
  from public, anon, authenticated;
grant execute on function public.mobile_giving_recurring(uuid, text) to service_role;

/*
 * One recurring gift, resolved to the Stripe id needed to stop it — and only
 * for the account that owns it.
 *
 * Separate from the projection above because it returns a provider identifier,
 * which never goes to a phone. The cancel path reads it server-side; the phone
 * sends the `subscription_id` the projection gave it and nothing else.
 */
create or replace function public.mobile_giving_recurring_owner(
  p_account_id uuid,
  p_church_slug text,
  p_subscription_id uuid
)
returns table (
  ok boolean,
  church_id uuid,
  stripe_subscription_id text,
  status text
)
language sql
stable
security definer
set search_path = public
as $$
  with church as (
    select c.id from public.churches c where c.slug = p_church_slug
  ),
  linked_donor as (
    select l.donor_id
      from public.giving_donor_links l
      join church on church.id = l.church_id
     where l.account_id = p_account_id
       and l.revoked_at is null
  )
  select true, s.church_id, s.stripe_subscription_id, s.status
  from public.giving_subscriptions s
  join church on church.id = s.church_id
  where s.id = p_subscription_id
    and s.donor_id in (select donor_id from linked_donor)
  limit 1;
$$;

revoke all on function public.mobile_giving_recurring_owner(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.mobile_giving_recurring_owner(uuid, text, uuid)
  to service_role;

notify pgrst, 'reload schema';
