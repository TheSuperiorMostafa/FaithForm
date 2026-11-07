-- Operations notifications retain only redacted probe names/counts. Leases and
-- immutable delivery snapshots make overlapping cron runs and send retries safe.
create table if not exists public.operations_alert_state (
  monitor_key text primary key,
  incident_fingerprint text,
  alert_payload jsonb,
  delivery_key uuid,
  lease_token uuid,
  lease_expires_at timestamptz,
  last_sent_fingerprint text,
  last_sent_at timestamptz,
  next_attempt_at timestamptz not null default '-infinity',
  updated_at timestamptz not null default now(),
  check (incident_fingerprint is null or incident_fingerprint ~ '^[0-9a-f]{64}$'),
  check ((lease_token is null) = (lease_expires_at is null))
);

alter table public.operations_alert_state enable row level security;
revoke all on public.operations_alert_state from public, anon, authenticated;
grant select, insert, update, delete on public.operations_alert_state to service_role;

create or replace function public.claim_operations_alert(
  p_monitor_key text,
  p_fingerprint text,
  p_payload jsonb,
  p_claim_token uuid,
  p_repeat boolean default false
) returns setof public.operations_alert_state
language plpgsql volatile security definer
set search_path = pg_catalog, public
as $$
declare
  v_state public.operations_alert_state;
  v_now timestamptz := clock_timestamp();
begin
  if p_claim_token is null or p_monitor_key is null or btrim(p_monitor_key) = '' then
    return;
  end if;
  -- ON CONFLICT itself waits on a locked existing row. Only initialize absent
  -- keys so established monitors reach SKIP LOCKED without blocking.
  if not exists (select 1 from public.operations_alert_state where monitor_key = p_monitor_key) then
    insert into public.operations_alert_state(monitor_key)
      values(p_monitor_key) on conflict do nothing;
  end if;
  select * into v_state from public.operations_alert_state
    where monitor_key = p_monitor_key for update skip locked;
  if not found or v_state.lease_expires_at > v_now then return; end if;

  -- Recovery is quiet. A later recurrence is a new incident and may notify.
  if p_fingerprint is null then
    update public.operations_alert_state set incident_fingerprint = null,
      alert_payload = null, delivery_key = null, lease_token = null,
      lease_expires_at = null, last_sent_fingerprint = null, last_sent_at = null,
      next_attempt_at = '-infinity', updated_at = v_now
      where monitor_key = p_monitor_key;
    return;
  end if;
  if p_fingerprint !~ '^[0-9a-f]{64}$' or p_payload is null or jsonb_typeof(p_payload) <> 'object' then
    raise exception 'Invalid operations alert';
  end if;

  if v_state.incident_fingerprint is distinct from p_fingerprint then
    update public.operations_alert_state set incident_fingerprint = p_fingerprint,
      alert_payload = p_payload, delivery_key = gen_random_uuid(),
      next_attempt_at = '-infinity', lease_token = null, lease_expires_at = null,
      updated_at = v_now where monitor_key = p_monitor_key;
  elsif v_state.last_sent_fingerprint = p_fingerprint then
    -- The normal monitor sends once per unchanged incident. Explicit test
    -- alerts may be repeated after the same one-hour cooldown.
    if not coalesce(p_repeat, false) then return; end if;
    if v_state.last_sent_at > v_now - interval '1 hour' then return; end if;
    update public.operations_alert_state set alert_payload = p_payload,
      delivery_key = gen_random_uuid(), next_attempt_at = '-infinity',
      updated_at = v_now where monitor_key = p_monitor_key;
  end if;
  select * into v_state from public.operations_alert_state where monitor_key = p_monitor_key;
  if v_state.next_attempt_at > v_now
     or v_state.last_sent_at > v_now - interval '1 hour' then return; end if;

  return query update public.operations_alert_state set lease_token = p_claim_token,
    lease_expires_at = v_now + interval '2 minutes', updated_at = v_now
    where monitor_key = p_monitor_key returning *;
end;
$$;

create or replace function public.complete_operations_alert(
  p_monitor_key text,
  p_claim_token uuid,
  p_sent boolean
) returns boolean
language plpgsql volatile security definer
set search_path = pg_catalog, public
as $$
begin
  update public.operations_alert_state set
    last_sent_fingerprint = case when p_sent then incident_fingerprint else last_sent_fingerprint end,
    last_sent_at = case when p_sent then clock_timestamp() else last_sent_at end,
    next_attempt_at = case when p_sent then '-infinity'::timestamptz
      else clock_timestamp() + interval '5 minutes' end,
    lease_token = null, lease_expires_at = null, updated_at = clock_timestamp()
    where monitor_key = p_monitor_key and lease_token = p_claim_token
      and lease_expires_at > clock_timestamp();
  return found;
end;
$$;

revoke all on function public.claim_operations_alert(text, text, jsonb, uuid, boolean)
  from public, anon, authenticated;
revoke all on function public.complete_operations_alert(text, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_operations_alert(text, text, jsonb, uuid, boolean) to service_role;
grant execute on function public.complete_operations_alert(text, uuid, boolean) to service_role;
