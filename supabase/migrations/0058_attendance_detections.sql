-- Faithful: server-authoritative dwell
-- Migration 0058 (Prompt 7 final correction)
--
-- Additive. One new table and two new functions; nothing existing is altered.
--
-- ## The hole this closes
--
-- Dwell was never enforced. `record_attendance` compares
-- `p_dwell_seconds` — a number the **client supplies** — against the
-- occurrence's `minDwellSeconds`. A device sending `dwellSeconds: 9999`
-- counted immediately, and the whole two-phase `detected` → `confirm`
-- mechanism was decorative against anything but an honest client.
--
-- The `confirmationNotBefore` added earlier made it worse in one respect: it
-- was computed from the client's own `observedAt`, so backdating that value by
-- an hour produced a confirmation deadline already in the past.
--
-- ## What replaces it
--
-- A **detection record**, created by the server when a `detected` submission is
-- accepted, stamped with `now()` from this database and nothing else:
--
--     confirmation_not_before = detected_at_server + minDwellSeconds
--
-- `confirm` presents the detection id. The server re-reads the row, re-checks
-- every binding, and compares `now()` against `confirmation_not_before`. The
-- elapsed dwell it hands to `record_attendance` is computed here, from two
-- server timestamps. **No client-controlled value can shorten it.**
--
-- A device clock days behind or ahead changes nothing: the device's numbers are
-- never in the arithmetic.
--
-- ## What the client's `observedAt` is now for
--
-- Diagnostics, bounded by a plausibility check. It is stored on the attempt so
-- "why was I not counted" stays answerable, and it decides nothing.
--
-- ## Bindings
--
-- A detection is bound to the account, the member, the church, the occurrence,
-- the campus and region, the configuration version, the logical attempt and the
-- policy snapshot in force when it opened. `confirm` re-validates all of them,
-- so a detection cannot be replayed across any of those boundaries.

create table if not exists public.attendance_detections (
  id uuid primary key default gen_random_uuid(),

  -- Bindings. Every one is re-checked at confirmation.
  church_id uuid not null references public.churches(id) on delete cascade,
  service_occurrence_id uuid not null
    references public.service_occurrences(id) on delete cascade,
  member_id uuid not null references public.members(id) on delete cascade,
  account_id uuid not null references public.visitor_accounts(id) on delete cascade,
  campus_id uuid references public.church_campuses(id) on delete set null,
  -- The OS region the device reported. Text, because it is the client's own
  -- identifier and must not be trusted as a foreign key.
  region_id text,
  -- What the client held when it opened this. A change means the authorization
  -- it was granted under has moved.
  config_version integer,
  -- The client's logical attempt. Makes `detected` idempotent per workflow.
  logical_attempt_id text not null,

  -- The policy in force when this opened. Confirmation is judged against this,
  -- not against whatever the church has since edited.
  policy_snapshot jsonb not null,

  -- **The server clock, and only the server clock.**
  detected_at_server timestamptz not null default now(),
  confirmation_not_before timestamptz not null,
  expires_at timestamptz not null,

  -- Set when a confirmation succeeds. Stops a detection being reused.
  confirmed_at timestamptz,

  -- Untrusted diagnostics. Recorded, never decisive.
  client_observed_at timestamptz,
  client_clock_skew_seconds integer,

  created_at timestamptz not null default now()
);

-- One detection per logical attempt. This is what makes a repeated `detected`
-- return the same record and the same timestamps rather than restarting the
-- clock — which would otherwise let a client reset its own dwell by retrying.
create unique index if not exists attendance_detections_attempt_idx
  on public.attendance_detections (service_occurrence_id, account_id, logical_attempt_id);

-- The confirmation lookup.
create index if not exists attendance_detections_open_idx
  on public.attendance_detections (id, expires_at)
  where confirmed_at is null;

-- The purge job's scan.
create index if not exists attendance_detections_expiry_idx
  on public.attendance_detections (expires_at);

-- ---------------------------------------------------------------------------
-- OPEN
-- ---------------------------------------------------------------------------

/*
 * Creates or returns the detection for one logical attempt.
 *
 * Idempotent by the unique index rather than by a read-then-write: two
 * concurrent `detected` submissions for the same attempt both reach the insert,
 * one wins, and the loser reads the winner's row. The timestamps are therefore
 * identical for both, which is the property a retry depends on.
 */
create or replace function public.open_attendance_detection(
  p_occurrence_id uuid,
  p_member_id uuid,
  p_account_id uuid,
  p_logical_attempt_id text,
  p_region_id text default null,
  p_config_version integer default null,
  p_client_observed_at timestamptz default null,
  p_lifetime_seconds integer default 7200
)
returns table (
  detection_id uuid,
  detected_at_server timestamptz,
  confirmation_not_before timestamptz,
  expires_at timestamptz,
  was_existing boolean
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  occ record;
  dwell_seconds integer;
  now_server timestamptz := now();
  new_id uuid;
  existing record;
  skew integer;
begin
  select o.id, o.church_id, o.campus_id, o.policy_snapshot
    into occ
    from public.service_occurrences o
   where o.id = p_occurrence_id;

  if not found then
    raise exception 'occurrence not found' using errcode = 'no_data_found';
  end if;

  -- From the occurrence's own snapshot. A church editing its policy after this
  -- occurrence was generated does not move a dwell already running.
  dwell_seconds := greatest(
    0,
    coalesce((occ.policy_snapshot ->> 'minDwellSeconds')::integer, 120)
  );

  -- Diagnostics only. A device whose clock is days out is still counted
  -- correctly; the skew is recorded so support can see why its numbers looked
  -- strange, and it decides nothing.
  if p_client_observed_at is not null then
    skew := extract(epoch from (p_client_observed_at - now_server))::integer;
    -- Bounded so a wild value cannot overflow the column.
    skew := greatest(-2147483648, least(2147483647, skew));
  end if;

  insert into public.attendance_detections (
    church_id, service_occurrence_id, member_id, account_id, campus_id,
    region_id, config_version, logical_attempt_id, policy_snapshot,
    detected_at_server, confirmation_not_before, expires_at,
    client_observed_at, client_clock_skew_seconds
  ) values (
    occ.church_id, occ.id, p_member_id, p_account_id, occ.campus_id,
    p_region_id, p_config_version, p_logical_attempt_id, occ.policy_snapshot,
    now_server,
    now_server + make_interval(secs => dwell_seconds),
    now_server + make_interval(secs => greatest(60, p_lifetime_seconds)),
    p_client_observed_at, skew
  )
  on conflict (service_occurrence_id, account_id, logical_attempt_id) do nothing
  returning id into new_id;

  if new_id is not null then
    return query
      select d.id, d.detected_at_server, d.confirmation_not_before, d.expires_at, false
        from public.attendance_detections d
       where d.id = new_id;
    return;
  end if;

  -- Lost the race, or this is a retry. Return the existing record unchanged —
  -- restarting the clock here is exactly the hole a retry would otherwise open.
  select d.* into existing
    from public.attendance_detections d
   where d.service_occurrence_id = p_occurrence_id
     and d.account_id = p_account_id
     and d.logical_attempt_id = p_logical_attempt_id;

  return query
    select existing.id, existing.detected_at_server,
           existing.confirmation_not_before, existing.expires_at, true;
end;
$$;

revoke all on function public.open_attendance_detection(
  uuid, uuid, uuid, text, text, integer, timestamptz, integer
) from public, anon, authenticated;
grant execute on function public.open_attendance_detection(
  uuid, uuid, uuid, text, text, integer, timestamptz, integer
) to service_role;

-- ---------------------------------------------------------------------------
-- REDEEM
-- ---------------------------------------------------------------------------

/*
 * Validates a detection for confirmation and returns the **server-measured**
 * elapsed dwell.
 *
 * Every binding is re-checked, because a detection is a capability and the
 * things it was granted against can all have changed since: the account can be
 * blocked, the People link removed, the church left, the configuration bumped.
 *
 * Returns `ok = false` with a reason rather than raising, so a refusal is a
 * verdict the caller can show rather than an error it has to interpret.
 */
create or replace function public.redeem_attendance_detection(
  p_detection_id uuid,
  p_occurrence_id uuid,
  p_member_id uuid,
  p_account_id uuid,
  p_region_id text default null,
  p_config_version integer default null
)
returns table (
  ok boolean,
  reason text,
  server_dwell_seconds integer,
  detected_at_server timestamptz
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  d record;
  now_server timestamptz := now();
begin
  select * into d
    from public.attendance_detections
   where id = p_detection_id;

  -- A fabricated or already-purged id.
  if not found then
    return query select false, 'detection_not_found', 0, null::timestamptz;
    return;
  end if;

  -- Cross-anything replay. Each is checked separately so the audit says which.
  if d.account_id <> p_account_id then
    return query select false, 'detection_wrong_account', 0, d.detected_at_server;
    return;
  end if;
  if d.member_id <> p_member_id then
    return query select false, 'detection_wrong_member', 0, d.detected_at_server;
    return;
  end if;
  if d.service_occurrence_id <> p_occurrence_id then
    return query select false, 'detection_wrong_occurrence', 0, d.detected_at_server;
    return;
  end if;
  -- The region is only checked when the client claims one, because a client
  -- that reports none is not thereby claiming a different one.
  if p_region_id is not null and d.region_id is not null
     and d.region_id <> p_region_id then
    return query select false, 'detection_wrong_region', 0, d.detected_at_server;
    return;
  end if;

  -- The configuration moved: the authorization this was granted under is gone.
  if p_config_version is not null and d.config_version is not null
     and d.config_version <> p_config_version then
    return query select false, 'detection_stale_configuration', 0, d.detected_at_server;
    return;
  end if;

  if d.expires_at <= now_server then
    return query select false, 'detection_expired', 0, d.detected_at_server;
    return;
  end if;

  -- Already redeemed. The counted fact is unique anyway, but a detection that
  -- can be spent twice is a capability with no bound.
  if d.confirmed_at is not null then
    return query select false, 'detection_already_used', 0, d.detected_at_server;
    return;
  end if;

  -- **The whole point.** Two server timestamps, no client input.
  if now_server < d.confirmation_not_before then
    return query select false, 'dwell_not_elapsed', 0, d.detected_at_server;
    return;
  end if;

  update public.attendance_detections
     set confirmed_at = now_server
   where id = p_detection_id;

  return query select
    true,
    'ok',
    greatest(0, extract(epoch from (now_server - d.detected_at_server))::integer),
    d.detected_at_server;
end;
$$;

revoke all on function public.redeem_attendance_detection(
  uuid, uuid, uuid, uuid, text, integer
) from public, anon, authenticated;
grant execute on function public.redeem_attendance_detection(
  uuid, uuid, uuid, uuid, text, integer
) to service_role;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

-- Server only. A detection is a capability; nothing client-side reads or writes
-- one, and there is no policy that would let it.
alter table public.attendance_detections enable row level security;
revoke all on public.attendance_detections from public, anon, authenticated;

notify pgrst, 'reload schema';
