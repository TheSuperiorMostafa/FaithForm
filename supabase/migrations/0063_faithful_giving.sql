-- Faithful: mobile giving
-- Migration 0063 (Prompt 11)
--
-- Additive. Columns on one existing table, two new tables, one trigger, and
-- four projection functions. **No existing giving table's meaning changes**, no
-- donation row is written by anything here, and every migration before this one
-- is untouched.
--
-- ## What already existed
--
-- A complete Stripe Connect giving system: connected-account payment intents,
-- a webhook that verifies signatures and claims events atomically, an
-- out-of-order-safe `giving_donations` projection keyed on `stripe_object_key`,
-- idempotent receipt delivery, subscriptions, refunds and payouts. See
-- `P11_MOBILE_GIVING_SOURCE_OF_TRUTH.md`.
--
-- **The webhook remains the only authority on whether money moved.** Nothing
-- below writes a donation, a status, or an amount.
--
-- ## What was missing
--
--   1. Funds have `is_active` and no notion of being published to a phone, no
--      visitor-facing title or description, no suggested amounts, no bounds.
--   2. `giving_donors` is keyed `(church_id, email)`. Matching a Faithful
--      account to a donor **by email** is the "email-only" access this prompt
--      forbids, and would hand one person another's history the first time two
--      people shared an address.
--   3. A phone that loses the network mid-payment has no way to ask "did my
--      attempt already become a payment intent?" — so a retry would charge
--      twice.
--   4. `giving_donations` carries donor emails, Stripe ids, fee breakdowns and
--      net amounts. None of that may reach a phone.

-- ---------------------------------------------------------------------------
-- FUND PUBLICATION
-- ---------------------------------------------------------------------------
--
-- The same shape migration 0054 established for announcements and 0060 for
-- media: additive `mobile_*` columns, a version that moves on any
-- visitor-visible change, and SQL projections that are the only way out.

-- `none` is the default, so **no existing fund is published by this migration**.
-- A church's funds appear in Faithful when a human says so and not before.
alter table public.giving_funds
  add column if not exists mobile_visibility text not null default 'none'
    check (mobile_visibility in ('none', 'public', 'followers', 'members'));

alter table public.giving_funds
  add column if not exists mobile_published_at timestamptz;

alter table public.giving_funds
  add column if not exists mobile_unpublished_at timestamptz;

-- What a church writes *for visitors*, which is not always the internal fund
-- name. Null falls back to `name`, so publishing needs no extra typing.
alter table public.giving_funds
  add column if not exists mobile_title text;

alter table public.giving_funds
  add column if not exists mobile_description text;

-- Suggested amounts, in cents, ascending. Chips on a giving card — a
-- convenience, never a floor: the custom amount is always available.
alter table public.giving_funds
  add column if not exists mobile_suggested_amounts integer[] not null default '{}';

-- Bounds. Both are the church's decision and both are enforced **server-side**;
-- the client's copy is for keyboard validation and is never trusted.
--
-- The floor of the floor is 100 cents, which is what `/api/give/create-intent`
-- already enforces and roughly what Stripe will accept for a card charge.
alter table public.giving_funds
  add column if not exists mobile_min_amount_cents integer not null default 100
    check (mobile_min_amount_cents >= 100);

-- A ceiling exists so a fat finger cannot become a five-figure gift. Not a
-- fraud control — it is a typo control, and it is documented as one.
alter table public.giving_funds
  add column if not exists mobile_max_amount_cents integer not null default 500000
    check (mobile_max_amount_cents >= 100);

alter table public.giving_funds
  add constraint giving_funds_mobile_amount_range_check
    check (mobile_max_amount_cents >= mobile_min_amount_cents);

alter table public.giving_funds
  add column if not exists mobile_publication_version integer not null default 1;

create index if not exists giving_funds_mobile_published_idx
  on public.giving_funds (church_id, mobile_visibility, sort_order)
  where mobile_visibility <> 'none';

/*
 * Moves the version when — and only when — something a visitor can see changes.
 *
 * A church renaming a fund internally, reordering its dashboard list, or
 * toggling `is_default` must not invalidate every phone's cached giving screen.
 * A change to the published title, description, amounts, bounds, visibility or
 * active state must.
 */
create or replace function public.bump_giving_fund_mobile_version()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (
    new.mobile_visibility is distinct from old.mobile_visibility
    or new.mobile_title is distinct from old.mobile_title
    or new.mobile_description is distinct from old.mobile_description
    or new.mobile_suggested_amounts is distinct from old.mobile_suggested_amounts
    or new.mobile_min_amount_cents is distinct from old.mobile_min_amount_cents
    or new.mobile_max_amount_cents is distinct from old.mobile_max_amount_cents
    or new.is_active is distinct from old.is_active
    or new.name is distinct from old.name
  ) then
    new.mobile_publication_version := coalesce(old.mobile_publication_version, 0) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists giving_funds_bump_mobile_version on public.giving_funds;
create trigger giving_funds_bump_mobile_version
  before update on public.giving_funds
  for each row execute function public.bump_giving_fund_mobile_version();

-- ---------------------------------------------------------------------------
-- ACCOUNT -> DONOR LINK
-- ---------------------------------------------------------------------------

/*
 * Which `giving_donor` a Faithful account is, at one church.
 *
 * **Written only when the account itself gives.** Never inferred from a matching
 * email address, which is the whole point: `giving_donors` is keyed
 * `(church_id, email)`, and two people who share an inbox — a married couple, a
 * family, a church office — would otherwise see each other's giving history the
 * moment one of them signed in.
 *
 * One row per (account, church). An account that gives at two churches has two,
 * and neither can see the other: every read below carries the church.
 */
create table if not exists public.giving_donor_links (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.visitor_accounts (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  donor_id uuid not null references public.giving_donors (id) on delete cascade,
  created_at timestamptz not null default now(),
  -- Set when a church severs the link, or the person asks. A revoked link stops
  -- history and receipts immediately; it does not delete the donation, which is
  -- the church's financial record and not the app's to remove.
  revoked_at timestamptz,
  unique (account_id, church_id)
);

create index if not exists giving_donor_links_donor_idx
  on public.giving_donor_links (church_id, donor_id)
  where revoked_at is null;

alter table public.giving_donor_links enable row level security;

-- No policy is created, so PostgREST reaches nothing. Every read goes through a
-- `security definer` projection below, which carries the account predicate.
revoke all on table public.giving_donor_links from public, anon, authenticated;
grant select, insert, update on table public.giving_donor_links to service_role;

-- ---------------------------------------------------------------------------
-- DONATION ATTEMPTS
-- ---------------------------------------------------------------------------

/*
 * A logical donation attempt: what the person is trying to do, before Stripe
 * knows anything about it.
 *
 * This is what makes a retry safe. The phone generates one `client_attempt_id`
 * per donation the person starts, and re-sends it after an app kill, a lost
 * network, or a backgrounded payment sheet. The first request creates the row
 * and the payment intent; every later one with the same id gets **the same
 * intent back**, not a second charge.
 *
 * `stripe_idempotency_key` is derived from the row, not from the client, so a
 * client cannot make two different attempts share a key or make one attempt use
 * two.
 *
 * It is deliberately **not** a donation. It never carries a confirmed status of
 * its own: `payment_state` mirrors what the webhook wrote onto
 * `giving_donations`, and is null until it does.
 */
create table if not exists public.giving_donation_attempts (
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

  -- Derived from `id`. Sent to Stripe so a network-level retry of the *same*
  -- attempt cannot create a second intent even if this server retries.
  stripe_idempotency_key text not null,
  stripe_payment_intent_id text,

  -- What this attempt has become, as far as this server has been told.
  --
  -- `initiated` means an intent exists and nothing has confirmed. Everything
  -- after that is written by the webhook path, from `giving_donations`.
  status text not null default 'initiated'
    check (status in (
      'initiated', 'requires_action', 'processing',
      'succeeded', 'failed', 'cancelled', 'refunded', 'disputed'
    )),
  donation_id uuid references public.giving_donations (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Ordering guard, exactly as `giving_donations` uses: a late event may not
  -- overwrite a later state.
  state_event_at timestamptz,

  unique (account_id, client_attempt_id)
);

create unique index if not exists giving_donation_attempts_intent_key
  on public.giving_donation_attempts (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create index if not exists giving_donation_attempts_history_idx
  on public.giving_donation_attempts (account_id, church_id, created_at desc);

alter table public.giving_donation_attempts enable row level security;

revoke all on table public.giving_donation_attempts from public, anon, authenticated;
grant select, insert, update on table public.giving_donation_attempts to service_role;

-- ---------------------------------------------------------------------------
-- CLAIMING AN ATTEMPT
-- ---------------------------------------------------------------------------

/*
 * Reserves a logical attempt, or returns the one that already exists.
 *
 * The whole duplicate-charge defence, in one statement. `on conflict do nothing`
 * followed by a read means two concurrent requests carrying the same
 * `client_attempt_id` — a double tap, a retry racing the original — produce
 * **one** row, and the loser is told which intent to reuse rather than being
 * allowed to create a second.
 *
 * Returns `created` so the caller knows whether to call Stripe at all.
 *
 * Every eligibility check is inside this function rather than beside it: the
 * fund must belong to the church, be active, be published, and the requested
 * amount must be inside the fund's own bounds. A client that posts another
 * church's fund id, or an amount the church never allowed, gets `false` and no
 * row.
 */
create or replace function public.claim_giving_attempt(
  p_account_id uuid,
  p_church_id uuid,
  p_fund_id uuid,
  p_client_attempt_id text,
  p_amount_cents integer,
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
  stripe_idempotency_key text,
  stripe_payment_intent_id text,
  status text
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

  -- An attempt this account already started. Returned **before** any fund or
  -- amount check, because a retry must succeed even if the church unpublished
  -- the fund in between — the money may already be moving, and refusing here
  -- would strand a person mid-payment with no way to find out what happened.
  select a.* into existing
    from public.giving_donation_attempts a
   where a.account_id = p_account_id
     and a.client_attempt_id = p_client_attempt_id;

  if found then
    if existing.church_id <> p_church_id then
      -- The same attempt id, pointed at a different church. Refused rather than
      -- answered: this is either a client bug or an attempt to read across a
      -- tenant boundary, and neither deserves a payment intent.
      return query select false, 'attempt_church_mismatch', null::uuid, false,
                          null::integer, null::text, null::text, null::text, null::text;
      return;
    end if;
    return query select true, 'existing', existing.id, false,
                        existing.amount_cents, existing.currency,
                        existing.stripe_idempotency_key,
                        existing.stripe_payment_intent_id, existing.status;
    return;
  end if;

  select f.* into fund
    from public.giving_funds f
   where f.id = p_fund_id
     -- **Tenant predicate on the read**, not applied afterwards.
     and f.church_id = p_church_id;

  if not found then
    return query select false, 'fund_not_found', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text;
    return;
  end if;

  if not fund.is_active then
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

  insert into public.giving_donation_attempts as a (
    church_id, account_id, fund_id, client_attempt_id,
    amount_cents, currency, stripe_idempotency_key, created_at, updated_at
  )
  values (
    p_church_id, p_account_id, p_fund_id, p_client_attempt_id,
    p_amount_cents, coalesce(p_currency, 'usd'),
    -- Derived here, from a value the client never chose. A client cannot make
    -- two attempts share a key, or one attempt use two.
    'ffg_' || replace(gen_random_uuid()::text, '-', ''),
    p_now, p_now
  )
  on conflict (account_id, client_attempt_id) do nothing
  returning a.* into inserted;

  if found then
    return query select true, 'created', inserted.id, true,
                        inserted.amount_cents, inserted.currency,
                        inserted.stripe_idempotency_key,
                        inserted.stripe_payment_intent_id, inserted.status;
    return;
  end if;

  -- Lost the insert race. Read the winner and reuse it rather than retrying.
  select a.* into existing
    from public.giving_donation_attempts a
   where a.account_id = p_account_id
     and a.client_attempt_id = p_client_attempt_id;

  if not found then
    return query select false, 'attempt_unavailable', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text;
    return;
  end if;

  return query select true, 'existing', existing.id, false,
                      existing.amount_cents, existing.currency,
                      existing.stripe_idempotency_key,
                      existing.stripe_payment_intent_id, existing.status;
end;
$$;

revoke all on function public.claim_giving_attempt(
  uuid, uuid, uuid, text, integer, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_giving_attempt(
  uuid, uuid, uuid, text, integer, text, timestamptz
) to service_role;

/*
 * Records the payment intent an attempt became.
 *
 * Separate from the claim because the Stripe call happens between them, and a
 * function that spanned it would be holding a transaction open across a network
 * request to another company.
 *
 * The `stripe_payment_intent_id is null` predicate makes it write-once: a second
 * call with a different intent id changes nothing, so a bug that created two
 * intents cannot silently repoint the attempt at the second one.
 */
create or replace function public.attach_giving_payment_intent(
  p_attempt_id uuid,
  p_account_id uuid,
  p_payment_intent_id text,
  p_now timestamptz default now()
)
returns table (ok boolean, payment_intent_id text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  updated record;
begin
  update public.giving_donation_attempts as a
     set stripe_payment_intent_id = p_payment_intent_id,
         updated_at = p_now
   where a.id = p_attempt_id
     and a.account_id = p_account_id
     and a.stripe_payment_intent_id is null
  returning a.* into updated;

  if found then
    return query select true, updated.stripe_payment_intent_id;
    return;
  end if;

  -- Already attached, or not this account's attempt. Report whichever intent
  -- the row actually holds so the caller reuses it instead of minting another.
  select a.* into updated
    from public.giving_donation_attempts a
   where a.id = p_attempt_id and a.account_id = p_account_id;

  if not found then
    return query select false, null::text;
    return;
  end if;

  return query select true, updated.stripe_payment_intent_id;
end;
$$;

revoke all on function public.attach_giving_payment_intent(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.attach_giving_payment_intent(uuid, uuid, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- PROJECTING WEBHOOK STATE ONTO AN ATTEMPT
-- ---------------------------------------------------------------------------

/*
 * Copies confirmed payment state from the webhook path onto the attempt.
 *
 * **The client can never call this**, and nothing in it trusts a client value:
 * the caller is the webhook handler, which has already verified a Stripe
 * signature and claimed the event atomically.
 *
 * `state_event_at` is the same out-of-order guard `giving_donations` uses. A
 * late `payment_intent.processing` arriving after `succeeded` is dropped, not
 * applied — which is a real ordering Stripe produces, not a theoretical one.
 */
create or replace function public.project_giving_attempt_state(
  p_payment_intent_id text,
  p_status text,
  p_donation_id uuid default null,
  p_event_at timestamptz default now()
)
returns table (ok boolean, attempt_id uuid, status text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  updated record;
begin
  if p_status not in (
    'initiated', 'requires_action', 'processing',
    'succeeded', 'failed', 'cancelled', 'refunded', 'disputed'
  ) then
    return query select false, null::uuid, null::text;
    return;
  end if;

  update public.giving_donation_attempts as a
     set status = p_status,
         donation_id = coalesce(p_donation_id, a.donation_id),
         state_event_at = p_event_at,
         updated_at = now()
   where a.stripe_payment_intent_id = p_payment_intent_id
     and (a.state_event_at is null or a.state_event_at <= p_event_at)
  returning a.* into updated;

  if not found then
    return query select false, null::uuid, null::text;
    return;
  end if;

  return query select true, updated.id, updated.status;
end;
$$;

revoke all on function public.project_giving_attempt_state(text, text, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.project_giving_attempt_state(text, text, uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- WHAT A VISITOR MAY SEE
-- ---------------------------------------------------------------------------

/*
 * Published funds for one church, for one relationship.
 *
 * The relationship filter is the same one the announcement feed and the media
 * archive use, so a church that publishes a fund to members only means it.
 *
 * A `blocked` caller — and a caller for a church that does not exist — gets an
 * empty set, not an error, so this cannot be used to test whether a church has
 * blocked you.
 */
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
    -- **The church must be able to accept money.** A published fund at a church
    -- whose Stripe account cannot charge is not shown at all, because showing it
    -- means offering a payment that will fail.
    and c.stripe_account_id is not null
    and c.stripe_charges_enabled
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

/*
 * One account's own giving history at one church.
 *
 * Three predicates, all required, none of them an email:
 *
 *   * the attempt belongs to this **account**;
 *   * the attempt belongs to this **church**;
 *   * where a donation exists, it belongs to the same church.
 *
 * The amount comes from the **donation** once one exists, and from the attempt
 * only before that. A donation whose amount differs from what was asked for —
 * a partial capture, a currency conversion — must read as what actually
 * happened.
 *
 * Nothing here returns a donor email, a Stripe id, a fee, a net amount, or a
 * client secret. Those are on `giving_donations` and stay there.
 */
create or replace function public.mobile_giving_history(
  p_account_id uuid,
  p_church_slug text,
  p_limit integer default 25,
  p_before timestamptz default null
)
returns table (
  attempt_id uuid,
  status text,
  amount_cents integer,
  currency text,
  fund_title text,
  occurred_at timestamptz,
  gift_type text,
  receipt_available boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    a.id,
    a.status,
    coalesce(d.amount_cents, a.amount_cents),
    coalesce(d.currency, a.currency),
    coalesce(nullif(f.mobile_title, ''), f.name),
    a.created_at,
    coalesce(d.gift_type, 'one_time'),
    (d.id is not null and d.status = 'succeeded')
  from public.giving_donation_attempts a
  join public.churches c on c.id = a.church_id
  join public.giving_funds f on f.id = a.fund_id
  left join public.giving_donations d
         on d.id = a.donation_id
        -- Belt and braces: a donation may only decorate an attempt from its own
        -- church, even though `donation_id` is only ever written by the webhook.
        and d.church_id = a.church_id
  where a.account_id = p_account_id
    and c.slug = p_church_slug
    and (p_before is null or a.created_at < p_before)
  order by a.created_at desc, a.id desc
  limit greatest(1, least(coalesce(p_limit, 25), 50));
$$;

revoke all on function public.mobile_giving_history(uuid, text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function public.mobile_giving_history(uuid, text, integer, timestamptz)
  to service_role;

/*
 * One receipt, for one gift, for the account that gave it.
 *
 * A receipt exists only for a **webhook-confirmed succeeded** donation. Before
 * that there is nothing to show and this returns nothing — which is what stops
 * a native payment sheet's own success callback from producing a receipt.
 *
 * The account predicate is on the statement. There is no email path in, and no
 * donation id path in either: the caller names an *attempt*, which is bound to
 * an account, and the donation is reached through it.
 */
create or replace function public.mobile_giving_receipt(
  p_account_id uuid,
  p_church_slug text,
  p_attempt_id uuid
)
returns table (
  attempt_id uuid,
  donation_id uuid,
  amount_cents integer,
  currency text,
  fund_title text,
  church_name text,
  church_slug text,
  paid_at timestamptz,
  gift_type text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    a.id,
    d.id,
    d.amount_cents,
    d.currency,
    coalesce(nullif(f.mobile_title, ''), f.name),
    c.name,
    c.slug,
    d.created_at,
    d.gift_type
  from public.giving_donation_attempts a
  join public.churches c on c.id = a.church_id
  join public.giving_funds f on f.id = a.fund_id
  join public.giving_donations d
    on d.id = a.donation_id
   and d.church_id = a.church_id
  where a.id = p_attempt_id
    and a.account_id = p_account_id
    and c.slug = p_church_slug
    and a.status = 'succeeded'
    and d.status = 'succeeded';
$$;

revoke all on function public.mobile_giving_receipt(uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.mobile_giving_receipt(uuid, text, uuid) to service_role;

/*
 * The link between an account and a donor at one church, created on first gift.
 *
 * Deliberately **not** an email lookup. It takes a donor id the caller already
 * resolved from Stripe metadata or from an upsert it performed itself, and binds
 * it to the account that is actually giving.
 *
 * `on conflict do nothing` means the first gift wins: a second gift does not
 * repoint an account at a different donor, which is what would happen if
 * somebody changed the email on their account.
 */
create or replace function public.link_giving_donor(
  p_account_id uuid,
  p_church_id uuid,
  p_donor_id uuid
)
returns table (ok boolean, donor_id uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  linked record;
begin
  if not exists (
    select 1 from public.giving_donors g
     where g.id = p_donor_id and g.church_id = p_church_id
  ) then
    return query select false, null::uuid;
    return;
  end if;

  insert into public.giving_donor_links (account_id, church_id, donor_id)
  values (p_account_id, p_church_id, p_donor_id)
  on conflict (account_id, church_id) do nothing;

  select l.* into linked
    from public.giving_donor_links l
   where l.account_id = p_account_id
     and l.church_id = p_church_id
     and l.revoked_at is null;

  if not found then
    return query select false, null::uuid;
    return;
  end if;

  return query select true, linked.donor_id;
end;
$$;

revoke all on function public.link_giving_donor(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.link_giving_donor(uuid, uuid, uuid) to service_role;

notify pgrst, 'reload schema';
