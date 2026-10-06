-- Expand recurring schedules without changing the legacy claim RPC signature.
-- No settled payment state is written here. Apply before deploying the new clients.
alter table public.giving_subscriptions drop constraint giving_subscriptions_interval_check;
alter table public.giving_subscriptions add constraint giving_subscriptions_interval_check
  check (interval in ('week', 'biweekly', 'month', 'year')) not valid;
alter table public.giving_subscriptions validate constraint giving_subscriptions_interval_check;
alter table public.giving_recurring_attempts drop constraint giving_recurring_attempts_interval_check;
alter table public.giving_recurring_attempts add constraint giving_recurring_attempts_interval_check
  check (interval in ('week', 'biweekly', 'month', 'year')) not valid;
alter table public.giving_recurring_attempts validate constraint giving_recurring_attempts_interval_check;
alter table public.giving_recurring_attempts
  add column first_charge_at timestamptz,
  add column billing_day_of_month integer check (billing_day_of_month between 1 and 31),
  add column billing_day_of_week integer check (billing_day_of_week between 0 and 6);

create or replace function public.claim_giving_recurring_attempt_v2(
  p_account_id uuid,
  p_church_id uuid,
  p_fund_id uuid,
  p_client_attempt_id text,
  p_amount_cents integer,
  p_interval text,
  p_currency text default 'usd',
  p_first_charge_at timestamptz default null,
  p_billing_day_of_month integer default null,
  p_billing_day_of_week integer default null,
  p_now timestamptz default now()
)
returns table (
  ok boolean,
  reason text,
  attempt_id uuid,
  created boolean,
  amount_cents integer,
  currency text,
  -- Quoted: `interval` is a type keyword, and unquoted it is a syntax error in
  -- a RETURNS TABLE list, which rolled this whole migration back.
  "interval" text,
  stripe_idempotency_key text,
  stripe_subscription_id text,
  first_charge_at timestamptz,
  billing_day_of_month integer,
  billing_day_of_week integer,
  fund_id uuid
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
                        null::integer, null::text, null::text, null::text, null::text,
                        null::timestamptz, null::integer, null::integer, null::uuid;
    return;
  end if;

  if p_interval is null or p_interval not in ('week', 'biweekly', 'month', 'year') then
    return query select false, 'invalid_interval', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text,
                        null::timestamptz, null::integer, null::integer, null::uuid;
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
                          null::integer, null::text, null::text, null::text, null::text,
                        null::timestamptz, null::integer, null::integer, null::uuid;
      return;
    end if;

    return query select true, 'existing', existing.id, false,
                        existing.amount_cents, existing.currency, existing.interval,
                        existing.stripe_idempotency_key, existing.stripe_subscription_id,
                        existing.first_charge_at, existing.billing_day_of_month, existing.billing_day_of_week, existing.fund_id;
    return;
  end if;

  if (p_first_charge_at is not null and (p_first_charge_at <= p_now or p_first_charge_at > p_now + interval '400 days'))
     or (p_billing_day_of_month is not null and p_billing_day_of_month not between 1 and 31)
     or (p_billing_day_of_week is not null and p_billing_day_of_week not between 0 and 6) then
    return query select false, 'invalid_schedule', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text,
                        null::timestamptz, null::integer, null::integer, null::uuid;
    return;
  end if;

  select f.* into fund
    from public.giving_funds f
   where f.id = p_fund_id
     and f.church_id = p_church_id;

  if not found then
    return query select false, 'fund_not_found', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text,
                        null::timestamptz, null::integer, null::integer, null::uuid;
    return;
  end if;

  if fund.is_active is not true then
    return query select false, 'fund_inactive', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text,
                        null::timestamptz, null::integer, null::integer, null::uuid;
    return;
  end if;

  if fund.mobile_visibility = 'none' then
    return query select false, 'fund_not_published', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text,
                        null::timestamptz, null::integer, null::integer, null::uuid;
    return;
  end if;

  if p_amount_cents is null
     or p_amount_cents < fund.mobile_min_amount_cents
     or p_amount_cents > fund.mobile_max_amount_cents then
    return query select false, 'amount_out_of_range', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text,
                        null::timestamptz, null::integer, null::integer, null::uuid;
    return;
  end if;

  insert into public.giving_recurring_attempts as a (
    church_id, account_id, fund_id, client_attempt_id,
    amount_cents, currency, interval, stripe_idempotency_key, created_at, updated_at,
    first_charge_at, billing_day_of_month, billing_day_of_week
  )
  values (
    p_church_id, p_account_id, p_fund_id, p_client_attempt_id,
    p_amount_cents, coalesce(p_currency, 'usd'), p_interval,
    'ffr_' || replace(gen_random_uuid()::text, '-', ''),
    p_now, p_now, p_first_charge_at, p_billing_day_of_month, p_billing_day_of_week
  )
  on conflict (account_id, client_attempt_id) do nothing
  returning a.* into inserted;

  if found then
    return query select true, 'created', inserted.id, true,
                        inserted.amount_cents, inserted.currency, inserted.interval,
                        inserted.stripe_idempotency_key, inserted.stripe_subscription_id,
                        inserted.first_charge_at, inserted.billing_day_of_month, inserted.billing_day_of_week, inserted.fund_id;
    return;
  end if;

  -- Lost the insert race. Read the winner and reuse it rather than retrying.
  select a.* into existing
    from public.giving_recurring_attempts a
   where a.account_id = p_account_id
     and a.client_attempt_id = p_client_attempt_id;

  if not found then
    return query select false, 'attempt_unavailable', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text,
                        null::timestamptz, null::integer, null::integer, null::uuid;
    return;
  end if;

  if existing.church_id is distinct from p_church_id then
    return query select false, 'attempt_church_mismatch', null::uuid, false,
                        null::integer, null::text, null::text, null::text, null::text,
                        null::timestamptz, null::integer, null::integer, null::uuid;
    return;
  end if;

  return query select true, 'existing', existing.id, false,
                      existing.amount_cents, existing.currency, existing.interval,
                      existing.stripe_idempotency_key, existing.stripe_subscription_id,
                        existing.first_charge_at, existing.billing_day_of_month, existing.billing_day_of_week, existing.fund_id;
end;
$$;

revoke all on function public.claim_giving_recurring_attempt_v2(
  uuid, uuid, uuid, text, integer, text, text, timestamptz, integer, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.claim_giving_recurring_attempt_v2(
  uuid, uuid, uuid, text, integer, text, text, timestamptz, integer, integer, timestamptz
) to service_role;
