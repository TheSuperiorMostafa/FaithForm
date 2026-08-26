-- Faithful: unified attendance authority — occurrences, attempts, counted facts
-- Migration 0055 (Prompt 6)
--
-- Additive. Depends on 0050 (security baseline), 0053 (visitor identity and
-- campuses), and 0054 (publication and push).
--
-- The invariant this migration exists to enforce, in the database rather than
-- in application code:
--
--     at most one counted attendance fact per (service_occurrence_id, member_id)
--
-- Manual entry, admin correction, geofence, QR and kiosk all converge on that
-- one row through one transactional command. `members.id` remains the only
-- People identity; nothing here creates a second one.
--
-- The legacy attendance_records/attendance_entries pair is left completely
-- untouched by this migration. It holds real history, and it is migrated by an
-- explicit, reconciled, reversible backfill — never by a trigger or a silent
-- rewrite. See P6_LEGACY_MIGRATION_AND_RECONCILIATION.md.
--
-- Rollback: every object here is new. Dropping them in reverse dependency
-- order restores the prior schema, and the legacy tables still hold every
-- attendance record they held before.

-- ---------------------------------------------------------------------------
-- ATTENDANCE POLICY
-- ---------------------------------------------------------------------------
--
-- Layered: a row may target a whole church, one campus, or one service time.
-- The most specific row wins, so a church can set a default and then say
-- "except the Wednesday evening service".
--
-- Everything automatic defaults to **off**. Applying this migration cannot
-- start counting anyone.

create table if not exists public.attendance_policies (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  campus_id uuid references public.church_campuses (id) on delete cascade,
  service_time_id uuid references public.church_service_times (id) on delete cascade,

  -- Sources. Manual is the only one on by default: it is what the dashboard
  -- already does, and turning it off would break an existing workflow.
  manual_enabled boolean not null default true,
  geofence_enabled boolean not null default false,
  qr_enabled boolean not null default false,
  kiosk_enabled boolean not null default false,

  -- The check-in window, relative to the service start. Opening early is
  -- normal; the closing offset is measured from the *end* so a long service
  -- does not close its own window halfway through.
  checkin_opens_minutes_before integer not null default 30
    check (checkin_opens_minutes_before between 0 and 240),
  checkin_closes_minutes_after integer not null default 30
    check (checkin_closes_minutes_after between 0 and 240),

  -- Someone arriving after this is still counted, but the attempt records that
  -- they were late. Null means the concept is not used.
  late_after_minutes integer
    check (late_after_minutes is null or late_after_minutes between 0 and 240),

  -- A GPS fix worse than this is refused rather than guessed at. 100 m is
  -- deliberately generous: a phone indoors is often worse than people expect,
  -- and refusing everyone helps nobody.
  max_location_accuracy_m integer not null default 100
    check (max_location_accuracy_m between 10 and 500),

  -- How long a device must remain inside the region before an attempt may be
  -- confirmed. Zero means a single entry event is enough — which the docs
  -- explicitly advise against for automatic attendance.
  min_dwell_seconds integer not null default 120
    check (min_dwell_seconds between 0 and 3600),

  -- Whether a confirmation step is required after detection. Separating
  -- detection from confirmation is what stops one region callback from being
  -- treated as unquestionable presence.
  requires_confirmation boolean not null default true,

  -- Who may reverse or restore a counted fact.
  correction_role text not null default 'admin'
    check (correction_role in ('admin', 'staff')),

  -- Days to keep the coarse validation evidence on an attempt. Short by
  -- default: it exists to answer "why was I not counted", not to build a
  -- movement history.
  evidence_retention_days integer not null default 14
    check (evidence_retention_days between 1 and 90),

  -- Bumped on every meaningful change. An occurrence snapshots this, so a
  -- policy edited after a service cannot retroactively change how that
  -- service's attempts were judged.
  policy_version integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  -- A policy may target exactly one level.
  constraint attendance_policies_one_scope
    check (num_nonnulls(campus_id, service_time_id) <= 1),

  -- A window that closes before it opens is a contradiction, not a preference.
  constraint attendance_policies_window_sane
    check (checkin_opens_minutes_before + checkin_closes_minutes_after > 0),

  -- Confirmation without dwell is a policy that says nothing.
  constraint attendance_policies_confirmation_sane
    check (not requires_confirmation or min_dwell_seconds > 0)
);

-- One policy per scope. The partial indexes keep church-level, campus-level and
-- service-level rows from colliding with each other.
create unique index if not exists attendance_policies_church_idx
  on public.attendance_policies (church_id)
  where campus_id is null and service_time_id is null;

create unique index if not exists attendance_policies_campus_idx
  on public.attendance_policies (campus_id)
  where campus_id is not null;

create unique index if not exists attendance_policies_service_idx
  on public.attendance_policies (service_time_id)
  where service_time_id is not null;

create or replace function public.bump_attendance_policy_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.* is distinct from old.* then
    new.policy_version := coalesce(old.policy_version, 1) + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists attendance_policies_bump_version on public.attendance_policies;
create trigger attendance_policies_bump_version
  before update on public.attendance_policies
  for each row execute function public.bump_attendance_policy_version();

-- ---------------------------------------------------------------------------
-- SERVICE OCCURRENCES
-- ---------------------------------------------------------------------------
--
-- One row per actual gathering. This is the thing attendance attaches to, and
-- it snapshots enough of the schedule, campus and policy that editing any of
-- them later cannot change what already happened.
--
-- `starts_at_utc` is resolved once, at generation, from the local date and the
-- campus timezone. Storing the resolved instant is what makes DST correct:
-- a 10:00 service is 14:00Z in winter and 15:00Z in summer, and both are
-- recorded as they actually were.

create table if not exists public.service_occurrences (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  campus_id uuid references public.church_campuses (id) on delete set null,

  -- Null for a manual or special occurrence that no recurring schedule
  -- produced. Set null rather than cascading if the schedule is later deleted:
  -- the occurrence still happened.
  service_time_id uuid references public.church_service_times (id) on delete set null,

  label text not null,
  -- The church's own calendar date. Kept alongside the resolved instant
  -- because "which Sunday" is how people actually talk about a service.
  local_service_date date not null,
  timezone text not null,

  starts_at_utc timestamptz not null,
  ends_at_utc timestamptz not null,
  checkin_opens_at_utc timestamptz not null,
  checkin_closes_at_utc timestamptz not null,

  status text not null default 'scheduled'
    check (status in ('scheduled', 'active', 'completed', 'cancelled')),

  generation_source text not null default 'schedule'
    check (generation_source in ('schedule', 'manual', 'legacy_backfill')),

  -- The policy as it stood when this occurrence was generated. An attempt is
  -- judged against these, never against the live policy row.
  policy_version integer not null default 1,
  policy_snapshot jsonb not null default '{}'::jsonb,

  -- Campus position at generation time, so moving a campus later does not
  -- retroactively move a past service.
  campus_latitude numeric(9, 6),
  campus_longitude numeric(9, 6),
  geofence_radius_m integer,

  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  cancellation_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null,

  constraint service_occurrences_window_sane
    check (ends_at_utc > starts_at_utc
           and checkin_closes_at_utc > checkin_opens_at_utc
           and checkin_opens_at_utc <= starts_at_utc)
);

-- Identity is the schedule plus the resolved start — not church and date.
-- Two services on the same Sunday are two rows, and a fall-back DST day with
-- two 01:30 locals resolves to two different instants.
create unique index if not exists service_occurrences_schedule_idx
  on public.service_occurrences (service_time_id, starts_at_utc)
  where service_time_id is not null;

-- A manual or special occurrence has no schedule, so it is identified by where
-- and when it is, plus its label.
create unique index if not exists service_occurrences_manual_idx
  on public.service_occurrences (church_id, coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid), starts_at_utc, label)
  where service_time_id is null;

-- The dashboard's exact filter and order.
create index if not exists service_occurrences_church_start_idx
  on public.service_occurrences (church_id, starts_at_utc desc, id desc);

-- "Which occurrence is open right now" — the hottest query in the system.
create index if not exists service_occurrences_open_window_idx
  on public.service_occurrences (church_id, checkin_opens_at_utc, checkin_closes_at_utc)
  where status in ('scheduled', 'active');

create index if not exists service_occurrences_campus_idx
  on public.service_occurrences (campus_id, starts_at_utc desc)
  where campus_id is not null;

-- ---------------------------------------------------------------------------
-- ATTENDANCE ATTEMPTS
-- ---------------------------------------------------------------------------
--
-- Append-only. Every submission from every source lands here whether or not it
-- counted, because "why was I not counted" is a question the church has to be
-- able to answer.
--
-- What is deliberately *not* here: raw coordinates as permanent history. An
-- attempt keeps a coarse distance band, an accuracy band, and a verdict.
-- `precise_evidence` exists for the short window where a support question might
-- need it, and a purge job empties it on the policy's schedule.

create table if not exists public.attendance_attempts (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  service_occurrence_id uuid not null references public.service_occurrences (id) on delete cascade,

  -- The person this attempt is about. Null only when the attempt was rejected
  -- before a People record could be resolved.
  member_id uuid references public.members (id) on delete set null,
  -- The visitor account that submitted it, for a self-check-in.
  account_id uuid references public.visitor_accounts (id) on delete set null,
  -- The staff member who submitted it, for manual or admin entry.
  actor_user_id uuid references auth.users (id) on delete set null,

  source text not null
    check (source in ('manual', 'admin', 'geofence', 'qr', 'kiosk')),
  actor_type text not null
    check (actor_type in ('visitor', 'staff', 'kiosk', 'system')),

  -- The client's own key for this logical intent. Unique per occurrence and
  -- source, so a retried submission finds its own earlier attempt.
  idempotency_key text not null,

  observed_at timestamptz,
  submitted_at timestamptz not null default now(),

  -- The policy version this attempt was judged against, copied from the
  -- occurrence. A later policy edit cannot change the verdict retroactively.
  policy_version integer not null default 1,

  status text not null
    check (status in ('counted', 'already_counted', 'rejected', 'pending_confirmation', 'expired')),
  -- A stable machine reason, never free text from a client.
  result_reason text not null,

  -- Coarse bands rather than values. "Within 50 m" answers a support question;
  -- a coordinate builds a location history.
  distance_band text
    check (distance_band is null or distance_band in ('inside', 'near', 'far', 'unknown')),
  accuracy_band text
    check (accuracy_band is null or accuracy_band in ('high', 'medium', 'low', 'unusable')),
  dwell_seconds integer check (dwell_seconds is null or dwell_seconds >= 0),

  -- Short-lived and purged. Never joined into a report, never returned to a
  -- client, and emptied by the retention job.
  precise_evidence jsonb,
  evidence_expires_at timestamptz,

  correlation_id uuid not null default gen_random_uuid(),
  created_at timestamptz not null default now()
);

-- The idempotency guarantee: one attempt per key, per occurrence, per source.
create unique index if not exists attendance_attempts_idempotency_idx
  on public.attendance_attempts (service_occurrence_id, source, idempotency_key);

create index if not exists attendance_attempts_occurrence_idx
  on public.attendance_attempts (service_occurrence_id, created_at desc);

create index if not exists attendance_attempts_member_idx
  on public.attendance_attempts (member_id, created_at desc)
  where member_id is not null;

-- The purge job's exact filter.
create index if not exists attendance_attempts_evidence_purge_idx
  on public.attendance_attempts (evidence_expires_at)
  where precise_evidence is not null;

-- ---------------------------------------------------------------------------
-- THE COUNTED FACT
-- ---------------------------------------------------------------------------
--
-- One row per person per occurrence. This is what reports count and what a
-- People profile shows.
--
-- Reversal is a state, never a delete: a fact that was counted and then
-- corrected is part of the record, and erasing it would make the correction
-- unauditable.

create table if not exists public.attendance_facts (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  service_occurrence_id uuid not null references public.service_occurrences (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,

  -- The attempt that created it. Kept even after a correction changes the
  -- source, so the original attribution survives.
  attempt_id uuid references public.attendance_attempts (id) on delete set null,
  source text not null
    check (source in ('manual', 'admin', 'geofence', 'qr', 'kiosk', 'legacy')),

  status text not null default 'active'
    check (status in ('active', 'reversed')),

  counted_at timestamptz not null default now(),
  reversed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- THE INVARIANT
-- ---------------------------------------------------------------------------
--
-- Not partial. A reversed fact still occupies the slot, which is exactly what
-- stops a reversal from being followed by a second insert that quietly
-- double-counts. Restoring flips the status back on the same row.
create unique index if not exists attendance_facts_unique_idx
  on public.attendance_facts (service_occurrence_id, member_id);

-- Reports count active facts and nothing else.
create index if not exists attendance_facts_occurrence_active_idx
  on public.attendance_facts (service_occurrence_id)
  where status = 'active';

create index if not exists attendance_facts_member_history_idx
  on public.attendance_facts (member_id, counted_at desc);

create index if not exists attendance_facts_church_reporting_idx
  on public.attendance_facts (church_id, counted_at desc, source);

-- ---------------------------------------------------------------------------
-- CORRECTIONS
-- ---------------------------------------------------------------------------
--
-- Append-only. Nothing in this table is ever updated or deleted.

create table if not exists public.attendance_corrections (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  service_occurrence_id uuid not null references public.service_occurrences (id) on delete cascade,
  member_id uuid references public.members (id) on delete set null,
  fact_id uuid references public.attendance_facts (id) on delete set null,

  action text not null check (action in ('reverse', 'restore', 'manual_add', 'occurrence_cancel')),
  previous_status text,
  new_status text,

  actor_user_id uuid references auth.users (id) on delete set null,
  reason text,
  idempotency_key text,

  created_at timestamptz not null default now()
);

create index if not exists attendance_corrections_occurrence_idx
  on public.attendance_corrections (service_occurrence_id, created_at desc);

create index if not exists attendance_corrections_member_idx
  on public.attendance_corrections (member_id, created_at desc)
  where member_id is not null;

-- ---------------------------------------------------------------------------
-- LEGACY MAPPING
-- ---------------------------------------------------------------------------
--
-- The bridge from the old batch model to the new one. Every legacy record and
-- entry that is migrated gets a row here, so the backfill is auditable,
-- re-runnable, and reversible — and so an ambiguity can be reported rather than
-- guessed at.

create table if not exists public.attendance_legacy_map (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,

  legacy_record_id uuid,
  legacy_entry_id uuid,
  legacy_service_date date not null,

  service_occurrence_id uuid references public.service_occurrences (id) on delete set null,
  attendance_fact_id uuid references public.attendance_facts (id) on delete set null,
  member_id uuid references public.members (id) on delete set null,

  -- `ambiguous` is the important one: legacy data that cannot prove which
  -- service a person attended is reported, not assigned.
  resolution text not null
    check (resolution in ('mapped', 'ambiguous', 'orphaned', 'skipped_absent', 'duplicate')),
  detail text,

  created_at timestamptz not null default now()
);

create unique index if not exists attendance_legacy_map_entry_idx
  on public.attendance_legacy_map (legacy_entry_id)
  where legacy_entry_id is not null;

create index if not exists attendance_legacy_map_church_idx
  on public.attendance_legacy_map (church_id, resolution);

-- ---------------------------------------------------------------------------
-- QR AND KIOSK
-- ---------------------------------------------------------------------------
--
-- A QR capability is signed rather than stored, so the code itself carries its
-- occurrence, purpose and expiry. What *is* stored is the set of consumed
-- nonces, because a signature alone cannot stop a replay.

create table if not exists public.attendance_qr_redemptions (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  service_occurrence_id uuid not null references public.service_occurrences (id) on delete cascade,
  nonce text not null,
  account_id uuid references public.visitor_accounts (id) on delete set null,
  redeemed_at timestamptz not null default now()
);

-- One redemption per nonce per occurrence: a replayed code collides.
create unique index if not exists attendance_qr_redemptions_nonce_idx
  on public.attendance_qr_redemptions (service_occurrence_id, nonce);

create table if not exists public.attendance_kiosk_credentials (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  campus_id uuid references public.church_campuses (id) on delete cascade,

  label text not null,
  -- Only the hash. A leaked backup does not yield a working kiosk.
  credential_hash text not null unique,

  is_enabled boolean not null default true,
  expires_at timestamptz,
  last_used_at timestamptz,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists attendance_kiosk_credentials_church_idx
  on public.attendance_kiosk_credentials (church_id, is_enabled)
  where is_enabled;

-- ---------------------------------------------------------------------------
-- THE TRANSACTIONAL ATTENDANCE COMMAND
-- ---------------------------------------------------------------------------
--
-- Every source ends here. Manual entry, admin correction, geofence, QR and
-- kiosk all call this one function, and it is the only thing in the system that
-- may create a counted fact.
--
-- It is a single PL/pgSQL function rather than a sequence of application calls
-- because the attempt and the fact must commit or roll back together. An
-- attempt recorded without its fact would under-count; a fact without its
-- attempt would be unauditable.
--
-- Concurrency is handled by the unique index, not by a read-then-write check.
-- Two simultaneous attempts — even from different sources — race into
-- `on conflict do nothing`, and exactly one of them observes an insert. The
-- loser reads the winner's row and reports `already_counted`, which is a
-- success from the caller's point of view.
--
-- Nothing here trusts the caller for tenancy: the church is read from the
-- occurrence, and the member is verified to belong to it.

create or replace function public.record_attendance(
  p_occurrence_id uuid,
  p_member_id uuid,
  p_source text,
  p_actor_type text,
  p_idempotency_key text,
  p_account_id uuid default null,
  p_actor_user_id uuid default null,
  p_observed_at timestamptz default null,
  p_distance_band text default null,
  p_accuracy_band text default null,
  p_dwell_seconds integer default null,
  p_precise_evidence jsonb default null,
  p_now timestamptz default now()
)
returns table (
  outcome text,
  reason text,
  fact_id uuid,
  attempt_id uuid,
  occurrence_id uuid
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  occ public.service_occurrences%rowtype;
  existing_attempt public.attendance_attempts%rowtype;
  existing_fact public.attendance_facts%rowtype;
  new_attempt_id uuid;
  new_fact_id uuid;
  member_church uuid;
  retention_days integer;
  attempt_status text;
  attempt_reason text;
begin
  -- 1. Resolve the occurrence. The church comes from here, never from a caller.
  select * into occ
  from public.service_occurrences
  where id = p_occurrence_id;

  if not found then
    return query select 'rejected', 'occurrence_not_found', null::uuid, null::uuid, null::uuid;
    return;
  end if;

  -- 2. Idempotency, before any validation: a retried submission must return
  --    what it returned the first time, not be re-judged against a window that
  --    may since have closed.
  select * into existing_attempt
  from public.attendance_attempts
  where service_occurrence_id = p_occurrence_id
    and source = p_source
    and idempotency_key = p_idempotency_key;

  if found then
    select * into existing_fact
    from public.attendance_facts
    where service_occurrence_id = p_occurrence_id
      and member_id = coalesce(existing_attempt.member_id, p_member_id);

    return query select
      case when existing_attempt.status = 'counted' then 'already_counted'
           else existing_attempt.status end,
      existing_attempt.result_reason,
      existing_fact.id,
      existing_attempt.id,
      occ.id;
    return;
  end if;

  retention_days := coalesce(
    (occ.policy_snapshot ->> 'evidenceRetentionDays')::integer, 14
  );

  -- 3. Validate. Each branch sets a machine-readable reason; none of them
  --    returns before the attempt is appended, because a rejected attempt is
  --    exactly the record someone will ask about.
  attempt_status := 'counted';
  attempt_reason := 'ok';

  if occ.status = 'cancelled' then
    attempt_status := 'rejected';
    attempt_reason := 'occurrence_cancelled';

  elsif not coalesce((occ.policy_snapshot -> 'sources' ->> p_source)::boolean, false) then
    -- The source must be enabled for this occurrence's policy snapshot, not
    -- for the policy as it stands now.
    attempt_status := 'rejected';
    attempt_reason := 'source_disabled';

  elsif p_now < occ.checkin_opens_at_utc then
    attempt_status := 'rejected';
    attempt_reason := 'too_early';

  elsif p_now > occ.checkin_closes_at_utc then
    attempt_status := 'rejected';
    attempt_reason := 'too_late';

  elsif p_member_id is null then
    attempt_status := 'rejected';
    attempt_reason := 'no_people_link';

  else
    -- The member must belong to this occurrence's church. A member id from
    -- another tenant resolves to nothing rather than being trusted.
    select church_id into member_church from public.members where id = p_member_id;
    if member_church is null or member_church <> occ.church_id then
      attempt_status := 'rejected';
      attempt_reason := 'member_not_in_church';
    end if;
  end if;

  -- Location sources carry extra requirements, judged against the snapshot.
  if attempt_status = 'counted' and p_source = 'geofence' then
    if p_accuracy_band = 'unusable' then
      attempt_status := 'rejected';
      attempt_reason := 'insufficient_accuracy';
    elsif p_distance_band is distinct from 'inside' then
      attempt_status := 'rejected';
      attempt_reason := 'outside_region';
    elsif coalesce((occ.policy_snapshot ->> 'requiresConfirmation')::boolean, true)
          and coalesce(p_dwell_seconds, 0)
              < coalesce((occ.policy_snapshot ->> 'minDwellSeconds')::integer, 120)
    then
      -- Not a rejection: the device has been seen but has not yet stayed long
      -- enough. Prompt 7/8 submits a confirmation once it has.
      attempt_status := 'pending_confirmation';
      attempt_reason := 'awaiting_dwell';
    end if;
  end if;

  -- 4. Append the attempt. Always, whatever the verdict.
  --
  -- `on conflict do nothing` closes the gap between the idempotency check in
  -- step 2 and this insert. Two connections submitting the same key — which is
  -- exactly what two concurrent batches do — would otherwise both pass the
  -- check and then collide on the unique index, aborting the whole
  -- transaction. Observed under two real connections before it was fixed.
  insert into public.attendance_attempts (
    church_id, service_occurrence_id, member_id, account_id, actor_user_id,
    source, actor_type, idempotency_key, observed_at, submitted_at,
    policy_version, status, result_reason,
    distance_band, accuracy_band, dwell_seconds,
    precise_evidence,
    evidence_expires_at
  ) values (
    occ.church_id, occ.id, p_member_id, p_account_id, p_actor_user_id,
    p_source, p_actor_type, p_idempotency_key, p_observed_at, p_now,
    occ.policy_version, attempt_status, attempt_reason,
    p_distance_band, p_accuracy_band, p_dwell_seconds,
    p_precise_evidence,
    case when p_precise_evidence is null then null
         else p_now + make_interval(days => retention_days) end
  )
  on conflict (service_occurrence_id, source, idempotency_key) do nothing
  returning id into new_attempt_id;

  -- Lost that race: another connection is recording the identical intent. Its
  -- attempt is the answer, and its fact — if any — is the counted one.
  if new_attempt_id is null then
    select * into existing_attempt
    from public.attendance_attempts
    where service_occurrence_id = p_occurrence_id
      and source = p_source
      and idempotency_key = p_idempotency_key;

    select * into existing_fact
    from public.attendance_facts
    where service_occurrence_id = occ.id
      and member_id = coalesce(existing_attempt.member_id, p_member_id);

    return query select
      case
        when existing_fact.id is not null then 'already_counted'
        when existing_attempt.status = 'counted' then 'already_counted'
        else coalesce(existing_attempt.status, 'rejected')
      end,
      coalesce(existing_attempt.result_reason, 'already_counted'),
      existing_fact.id,
      existing_attempt.id,
      occ.id;
    return;
  end if;

  if attempt_status <> 'counted' then
    return query select attempt_status, attempt_reason, null::uuid, new_attempt_id, occ.id;
    return;
  end if;

  -- 5. The counted fact. `on conflict do nothing` is the whole concurrency
  --    story: simultaneous attempts from any mix of sources race here, and the
  --    unique index admits exactly one.
  insert into public.attendance_facts (
    church_id, service_occurrence_id, member_id, attempt_id, source, status, counted_at
  ) values (
    occ.church_id, occ.id, p_member_id, new_attempt_id, p_source, 'active', p_now
  )
  on conflict (service_occurrence_id, member_id) do nothing
  returning id into new_fact_id;

  if new_fact_id is not null then
    return query select 'counted', 'ok', new_fact_id, new_attempt_id, occ.id;
    return;
  end if;

  -- Lost the race, or this person was already counted. Either way the answer
  -- is the existing row — and the attempt is corrected to say so.
  select * into existing_fact
  from public.attendance_facts
  where service_occurrence_id = occ.id and member_id = p_member_id;

  update public.attendance_attempts
     set status = 'already_counted', result_reason = 'already_counted'
   where id = new_attempt_id;

  -- A previously reversed fact is not silently revived by a new attempt;
  -- restoring it is an authorized correction.
  return query select
    case when existing_fact.status = 'reversed' then 'reversed' else 'already_counted' end,
    case when existing_fact.status = 'reversed' then 'reversed' else 'already_counted' end,
    existing_fact.id,
    new_attempt_id,
    occ.id;
end;
$$;

revoke all on function public.record_attendance(
  uuid, uuid, text, text, text, uuid, uuid, timestamptz, text, text, integer, jsonb, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_attendance(
  uuid, uuid, text, text, text, uuid, uuid, timestamptz, text, text, integer, jsonb, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- CORRECTIONS
-- ---------------------------------------------------------------------------
--
-- Reversal and restoration are the only ways a counted fact changes state, and
-- both append to the audit. Neither deletes anything.

create or replace function public.correct_attendance(
  p_fact_id uuid,
  p_church_id uuid,
  p_action text,
  p_actor_user_id uuid,
  p_reason text default null,
  p_now timestamptz default now()
)
returns table (ok boolean, reason text, new_status text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  fact public.attendance_facts%rowtype;
  target_status text;
begin
  -- Exact tenant predicate: a fact id from another church matches nothing.
  select * into fact
  from public.attendance_facts
  where id = p_fact_id and church_id = p_church_id
  for update;

  if not found then
    return query select false, 'not_found', null::text;
    return;
  end if;

  target_status := case when p_action = 'reverse' then 'reversed' else 'active' end;

  if fact.status = target_status then
    -- Already where the caller wants it. Idempotent, and no second audit row.
    return query select true, 'no_change', fact.status;
    return;
  end if;

  update public.attendance_facts
     set status = target_status,
         reversed_at = case when target_status = 'reversed' then p_now else null end,
         updated_at = p_now
   where id = fact.id;

  insert into public.attendance_corrections (
    church_id, service_occurrence_id, member_id, fact_id,
    action, previous_status, new_status, actor_user_id, reason
  ) values (
    fact.church_id, fact.service_occurrence_id, fact.member_id, fact.id,
    p_action, fact.status, target_status, p_actor_user_id, p_reason
  );

  return query select true, 'ok', target_status;
end;
$$;

revoke all on function public.correct_attendance(uuid, uuid, text, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.correct_attendance(uuid, uuid, text, uuid, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- OCCURRENCE GENERATION
-- ---------------------------------------------------------------------------
--
-- Deterministic and idempotent. Running it twice over the same horizon produces
-- the same occurrences, and `on conflict do nothing` means two concurrent
-- generators cannot create a duplicate.
--
-- The resolved instant is computed by Postgres from the local date, the local
-- time and the campus timezone. That is what makes DST correct without any
-- application-side offset arithmetic: `timestamp at time zone 'America/New_York'`
-- knows about the transition, and a naive UTC calculation does not.

create or replace function public.generate_service_occurrences(
  p_church_id uuid,
  p_from_date date,
  p_to_date date,
  p_now timestamptz default now()
)
returns table (created integer, skipped integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  st record;
  day date;
  policy record;
  local_start timestamp;
  resolved_start timestamptz;
  resolved_end timestamptz;
  zone text;
  created_count integer := 0;
  skipped_count integer := 0;
  inserted uuid;
begin
  -- A runaway horizon would generate years of rows in one call.
  if p_to_date - p_from_date > 400 then
    raise exception 'horizon too large' using errcode = 'check_violation';
  end if;

  for st in
    select s.id, s.church_id, s.campus_id, s.label, s.day_of_week,
           s.start_time, s.end_time, s.kind,
           c.timezone as campus_timezone,
           c.latitude, c.longitude, c.geofence_radius_m,
           ch.timezone as church_timezone
      from public.church_service_times s
      join public.churches ch on ch.id = s.church_id
      left join public.church_campuses c
        on c.id = s.campus_id and c.is_active
     where s.church_id = p_church_id
  loop
    -- Campus zone wins; the church's own zone is the fallback for a schedule
    -- that has not been attached to a campus yet.
    zone := coalesce(st.campus_timezone, st.church_timezone, 'America/New_York');

    -- The most specific policy that applies, resolved once per schedule.
    select * into policy
      from public.attendance_policies ap
     where ap.church_id = p_church_id
       and (ap.service_time_id = st.id
            or (ap.service_time_id is null and ap.campus_id is not distinct from st.campus_id)
            or (ap.service_time_id is null and ap.campus_id is null))
     order by (ap.service_time_id is not null) desc, (ap.campus_id is not null) desc
     limit 1;

    day := p_from_date;
    while day <= p_to_date loop
      -- `day_of_week` is 0-based from Sunday, matching church_service_times.
      if extract(dow from day)::integer = st.day_of_week then
        local_start := (day + st.start_time)::timestamp;
        resolved_start := local_start at time zone zone;
        resolved_end := ((day + coalesce(st.end_time, st.start_time + interval '90 minutes'))::timestamp)
                        at time zone zone;

        -- A schedule whose end precedes its start crosses midnight.
        if resolved_end <= resolved_start then
          resolved_end := resolved_end + interval '1 day';
        end if;

        insert into public.service_occurrences (
          church_id, campus_id, service_time_id, label, local_service_date, timezone,
          starts_at_utc, ends_at_utc,
          checkin_opens_at_utc, checkin_closes_at_utc,
          status, generation_source,
          policy_version, policy_snapshot,
          campus_latitude, campus_longitude, geofence_radius_m
        ) values (
          st.church_id, st.campus_id, st.id, st.label, day, zone,
          resolved_start, resolved_end,
          resolved_start - make_interval(mins => coalesce(policy.checkin_opens_minutes_before, 30)),
          resolved_end + make_interval(mins => coalesce(policy.checkin_closes_minutes_after, 30)),
          'scheduled', 'schedule',
          coalesce(policy.policy_version, 1),
          -- The snapshot the command judges attempts against.
          jsonb_build_object(
            'sources', jsonb_build_object(
              'manual', coalesce(policy.manual_enabled, true),
              'admin', true,
              'geofence', coalesce(policy.geofence_enabled, false),
              'qr', coalesce(policy.qr_enabled, false),
              'kiosk', coalesce(policy.kiosk_enabled, false)
            ),
            'maxLocationAccuracyM', coalesce(policy.max_location_accuracy_m, 100),
            'minDwellSeconds', coalesce(policy.min_dwell_seconds, 120),
            'requiresConfirmation', coalesce(policy.requires_confirmation, true),
            'lateAfterMinutes', policy.late_after_minutes,
            'evidenceRetentionDays', coalesce(policy.evidence_retention_days, 14),
            'correctionRole', coalesce(policy.correction_role, 'admin')
          ),
          st.latitude, st.longitude, st.geofence_radius_m
        )
        on conflict (service_time_id, starts_at_utc)
          where service_time_id is not null
        do nothing
        returning id into inserted;

        if inserted is not null then
          created_count := created_count + 1;
          inserted := null;
        else
          -- Already generated. Not an error: this is what makes re-running and
          -- concurrent generators safe.
          skipped_count := skipped_count + 1;
        end if;
      end if;

      day := day + 1;
    end loop;
  end loop;

  return query select created_count, skipped_count;
end;
$$;

revoke all on function public.generate_service_occurrences(uuid, date, date, timestamptz)
  from public, anon, authenticated;
grant execute on function public.generate_service_occurrences(uuid, date, date, timestamptz)
  to service_role;

-- A one-off service that no recurring schedule produced.
--
-- The instant is resolved here rather than in application code for the same
-- reason generation resolves it here: `AT TIME ZONE` knows about DST, and a
-- JavaScript offset calculation on a transition day does not.
--
-- Its policy snapshot comes from the church's own policy, so a manual service
-- obeys the same source rules as a scheduled one.

create or replace function public.create_manual_occurrence(
  p_church_id uuid,
  p_campus_id uuid,
  p_label text,
  p_local_date date,
  p_start_time time,
  p_duration_minutes integer,
  p_timezone text,
  p_opens_before integer,
  p_closes_after integer,
  p_actor_user_id uuid
)
returns table (id uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  resolved_start timestamptz;
  resolved_end timestamptz;
  policy record;
  new_id uuid;
begin
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'invalid IANA timezone: %', p_timezone
      using errcode = 'check_violation';
  end if;

  resolved_start := ((p_local_date + p_start_time)::timestamp) at time zone p_timezone;
  resolved_end := resolved_start + make_interval(mins => greatest(p_duration_minutes, 15));

  select * into policy
    from public.attendance_policies ap
   where ap.church_id = p_church_id
     and (ap.campus_id is not distinct from p_campus_id or ap.campus_id is null)
     and ap.service_time_id is null
   order by (ap.campus_id is not null) desc
   limit 1;

  insert into public.service_occurrences (
    church_id, campus_id, service_time_id, label, local_service_date, timezone,
    starts_at_utc, ends_at_utc, checkin_opens_at_utc, checkin_closes_at_utc,
    status, generation_source, policy_version, policy_snapshot,
    campus_latitude, campus_longitude, geofence_radius_m, created_by
  )
  select
    p_church_id, p_campus_id, null, p_label, p_local_date, p_timezone,
    resolved_start, resolved_end,
    resolved_start - make_interval(mins => coalesce(p_opens_before, 30)),
    resolved_end + make_interval(mins => coalesce(p_closes_after, 30)),
    'scheduled', 'manual',
    coalesce(policy.policy_version, 1),
    jsonb_build_object(
      'sources', jsonb_build_object(
        'manual', coalesce(policy.manual_enabled, true),
        'admin', true,
        'geofence', coalesce(policy.geofence_enabled, false),
        'qr', coalesce(policy.qr_enabled, false),
        'kiosk', coalesce(policy.kiosk_enabled, false)
      ),
      'maxLocationAccuracyM', coalesce(policy.max_location_accuracy_m, 100),
      'minDwellSeconds', coalesce(policy.min_dwell_seconds, 120),
      'requiresConfirmation', coalesce(policy.requires_confirmation, true),
      'lateAfterMinutes', policy.late_after_minutes,
      'evidenceRetentionDays', coalesce(policy.evidence_retention_days, 14),
      'correctionRole', coalesce(policy.correction_role, 'admin')
    ),
    cc.latitude, cc.longitude, cc.geofence_radius_m, p_actor_user_id
  from (select 1) as _
  left join public.church_campuses cc on cc.id = p_campus_id
  returning public.service_occurrences.id into new_id;

  return query select new_id;
end;
$$;

revoke all on function public.create_manual_occurrence(
  uuid, uuid, text, date, time, integer, text, integer, integer, uuid
) from public, anon, authenticated;
grant execute on function public.create_manual_occurrence(
  uuid, uuid, text, date, time, integer, text, integer, integer, uuid
) to service_role;

-- ---------------------------------------------------------------------------
-- REPORTING
-- ---------------------------------------------------------------------------
--
-- Aggregated in SQL. Loading every member and every fact into application
-- memory to count them is exactly what this replaces.

create or replace function public.attendance_report(
  p_church_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_campus_id uuid default null,
  p_source text default null
)
returns table (
  occurrence_id uuid,
  label text,
  local_service_date date,
  starts_at_utc timestamptz,
  campus_name text,
  counted integer,
  reversed integer,
  by_source jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  select
    o.id,
    o.label,
    o.local_service_date,
    o.starts_at_utc,
    cc.name,
    coalesce(counts.active_count, 0)::integer,
    coalesce(counts.reversed_count, 0)::integer,
    coalesce(counts.by_source, '{}'::jsonb)
  from public.service_occurrences o
  left join public.church_campuses cc on cc.id = o.campus_id
  -- One aggregation per occurrence, in SQL. Nothing is counted in application
  -- memory, and an occurrence with no attendance still appears with zero.
  left join lateral (
    select
      count(*) filter (where af.status = 'active') as active_count,
      count(*) filter (where af.status = 'reversed') as reversed_count,
      -- Active facts only: a reversed one is not attendance by source.
      coalesce(
        jsonb_object_agg(af.source, af.n) filter (where af.status = 'active'),
        '{}'::jsonb
      ) as by_source
    from (
      select f.source, f.status, count(*)::integer as n
      from public.attendance_facts f
      where f.service_occurrence_id = o.id
        and (p_source is null or f.source = p_source)
      group by f.source, f.status
    ) af
  ) counts on true
  where o.church_id = p_church_id
    and o.starts_at_utc >= p_from
    and o.starts_at_utc < p_to
    and (p_campus_id is null or o.campus_id = p_campus_id)
  order by o.starts_at_utc desc, o.id desc
$$;

revoke all on function public.attendance_report(uuid, timestamptz, timestamptz, uuid, text)
  from public, anon, authenticated;
grant execute on function public.attendance_report(uuid, timestamptz, timestamptz, uuid, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- RLS AND GRANTS
-- ---------------------------------------------------------------------------

alter table public.attendance_policies enable row level security;
alter table public.service_occurrences enable row level security;
alter table public.attendance_attempts enable row level security;
alter table public.attendance_facts enable row level security;
alter table public.attendance_corrections enable row level security;
alter table public.attendance_legacy_map enable row level security;
alter table public.attendance_qr_redemptions enable row level security;
alter table public.attendance_kiosk_credentials enable row level security;

revoke all on table public.attendance_policies from anon, authenticated;
revoke all on table public.service_occurrences from anon, authenticated;
revoke all on table public.attendance_attempts from anon, authenticated;
revoke all on table public.attendance_facts from anon, authenticated;
revoke all on table public.attendance_corrections from anon, authenticated;
revoke all on table public.attendance_legacy_map from anon, authenticated;
revoke all on table public.attendance_qr_redemptions from anon, authenticated;
revoke all on table public.attendance_kiosk_credentials from anon, authenticated;

grant select on table public.attendance_policies to authenticated;
grant select on table public.service_occurrences to authenticated;
grant select on table public.attendance_facts to authenticated;
grant select on table public.attendance_corrections to authenticated;

grant select, insert, update, delete
  on table public.attendance_policies,
     public.service_occurrences,
     public.attendance_attempts,
     public.attendance_facts,
     public.attendance_corrections,
     public.attendance_legacy_map,
     public.attendance_qr_redemptions,
     public.attendance_kiosk_credentials
  to service_role;

-- Staff of the church may read configuration and occurrences. Writes go
-- through the transactional command, so there is no client write policy.
create policy attendance_policies_select on public.attendance_policies
  for select to authenticated
  using (public.is_church_staff(church_id));

create policy service_occurrences_select on public.service_occurrences
  for select to authenticated
  using (public.is_church_staff(church_id));

-- A counted fact is visible to staff of that church, and to the account
-- verifiably linked to that People record. Nobody else — an attendance history
-- is not public to other visitors of the same church.
create policy attendance_facts_select on public.attendance_facts
  for select to authenticated
  using (
    public.is_church_staff(church_id)
    or exists (
      select 1
      from public.visitor_people_links l
      where l.member_id = attendance_facts.member_id
        and l.church_id = attendance_facts.church_id
        and l.is_active
        and l.account_id = public.current_visitor_account_id()
    )
  );

create policy attendance_corrections_select on public.attendance_corrections
  for select to authenticated
  using (public.is_church_staff(church_id));

-- Attempts carry validation evidence and are staff-only by way of the server.
-- Legacy mapping, QR redemptions and kiosk credentials have no browser policy
-- at all: the first is an operational record, and the last two hold replay and
-- credential material.

notify pgrst, 'reload schema';
