-- Automatic attendance a church can actually set up
-- Migration 0074
--
-- Additive in effect. New helper functions, one new audit table, three
-- replaced function bodies with unchanged signatures, one rebuilt partial
-- index, and a narrower bound on the campus check-in radius. No attendance
-- fact, attempt or correction is written or rewritten.
--
-- ## What was wrong
--
-- Every piece of the automatic attendance authority existed (0055, 0058), but
-- nothing a church could do from the dashboard made it work:
--
--   1. **Church-wide service times had no location.** The website editor saves
--      service times with no campus, and the generator snapshotted the campus
--      position from the service time's own campus. So every occurrence of an
--      ordinary one-campus church carried null coordinates, every geofence
--      attempt banded `unknown`, and `record_attendance` refused it as
--      `outside_region`. Nobody could ever be counted automatically.
--
--   2. **A snapshot taken weeks early never caught up.** Occurrences are
--      generated 60 days ahead and snapshot the policy and campus position at
--      that moment. A church that turned automatic check-in on, set its
--      location, or widened its check-in window today was refused
--      `source_disabled` (or banded against no position) for up to two months.
--
--   3. **A changed or deleted service time left its future services behind.**
--      Moving the 10:00 service to 10:30 kept every future 10:00 occurrence and
--      added the 10:30 ones beside it, and a deleted service time left its
--      future occurrences scheduled with no schedule at all.
--
--   4. **Deleting a service time could fail outright.** On delete the
--      occurrences' `service_time_id` is set null, which moves them under the
--      manual-occurrence unique index. A service time deleted, re-added with the
--      same name and time, and deleted again collided with its own earlier
--      orphan, and the website editor's save failed.
--
--   5. **Server-side detections were never purged**, and withdrawing consent
--      left open detections and pending attempts in place.
--
-- ## What this adds
--
--   - `attendance_effective_campus`: a service time with no campus happens at
--     the church's main campus (or its only one).
--   - `attendance_policy_for` and `attendance_policy_snapshot`: one resolution
--     of the most specific policy and one snapshot shape, shared by generation,
--     manual services and refresh, so the three cannot drift.
--   - `refresh_upcoming_service_occurrences`: re-derives every occurrence whose
--     check-in has **not opened yet** from the current schedule, policy and
--     campus. Nothing has happened at those services, so updating them rewrites
--     no history; an occurrence whose check-in has opened keeps its snapshot,
--     exactly as P6 requires.
--   - `purge_expired_attendance_detections` and
--     `withdraw_automatic_attendance_evidence`.
--   - `attendance_setup_events`: who changed a church's check-in setup, and
--     from what to what.
--
-- Rollback: drop the new functions and table, restore the 0055 bodies of
-- `generate_service_occurrences` and `create_manual_occurrence`, restore the
-- 0055 predicate of `service_occurrences_manual_idx`, and restore the radius
-- check to `between 25 and 2000`. Radii clamped by this migration stay clamped.

-- ---------------------------------------------------------------------------
-- The check-in radius
-- ---------------------------------------------------------------------------
--
-- 25 m is inside ordinary GPS noise, so a region that small fires unreliably
-- on both platforms; 2 km is a neighbourhood, which would count someone at the
-- supermarket across the road. 50 to 500 m covers a building to a large campus.
-- Existing values outside that range are moved to the nearest bound first so
-- the constraint can be validated.

update public.church_campuses
   set geofence_radius_m = least(500, greatest(50, geofence_radius_m))
 where geofence_radius_m < 50 or geofence_radius_m > 500;

alter table public.church_campuses
  drop constraint if exists church_campuses_geofence_radius_m_check;

alter table public.church_campuses
  add constraint church_campuses_geofence_radius_m_check
  check (geofence_radius_m between 50 and 500);

-- ---------------------------------------------------------------------------
-- Occurrence identity
-- ---------------------------------------------------------------------------
--
-- The manual-occurrence index exists for occurrences no schedule produced. An
-- occurrence a schedule produced keeps `generation_source = 'schedule'` after
-- its schedule is deleted, so it is excluded here and can never collide with
-- another orphan of the same service. The identity of a genuinely manual or
-- backfilled occurrence is unchanged.

drop index if exists public.service_occurrences_manual_idx;

create unique index if not exists service_occurrences_manual_idx
  on public.service_occurrences (
    church_id,
    coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid),
    starts_at_utc,
    label
  )
  where service_time_id is null and generation_source <> 'schedule';

-- ---------------------------------------------------------------------------
-- Where a service happens
-- ---------------------------------------------------------------------------
--
-- A service time attached to a campus happens there. One with no campus (every
-- service time the website editor has ever saved) happens at the church's main
-- campus, or at its only active campus when none is marked main. A church with
-- several campuses and no main one gets null: guessing would band attempts
-- against the wrong building, and null fails closed.

create or replace function public.attendance_effective_campus(
  p_church_id uuid,
  p_campus_id uuid
)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    p_campus_id,
    (
      select c.id
        from public.church_campuses c
       where c.church_id = p_church_id
         and c.is_active
         and c.is_primary
       limit 1
    ),
    (
      select c.id
        from public.church_campuses c
       where c.church_id = p_church_id
         and c.is_active
         and (
           select count(*)
             from public.church_campuses other
            where other.church_id = p_church_id
              and other.is_active
         ) = 1
       limit 1
    )
  )
$$;

revoke all on function public.attendance_effective_campus(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.attendance_effective_campus(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- Which policy applies, and what an occurrence remembers of it
-- ---------------------------------------------------------------------------
--
-- The most specific row wins: the service time's own policy, then its campus's,
-- then the church's. Identical to the resolution 0055 wrote inline twice. With
-- no row at all the result is null, and every snapshot field falls back to the
-- column defaults, so a church that never opened the setup page behaves
-- exactly as before.

create or replace function public.attendance_policy_for(
  p_church_id uuid,
  p_campus_id uuid,
  p_service_time_id uuid
)
returns public.attendance_policies
language sql
stable
security definer
set search_path = public
as $$
  select ap.*
    from public.attendance_policies ap
   where ap.church_id = p_church_id
     and (
       (p_service_time_id is not null and ap.service_time_id = p_service_time_id)
       or (ap.service_time_id is null and ap.campus_id is not distinct from p_campus_id)
       or (ap.service_time_id is null and ap.campus_id is null)
     )
   order by (ap.service_time_id is not null) desc, (ap.campus_id is not null) desc
   limit 1
$$;

revoke all on function public.attendance_policy_for(uuid, uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.attendance_policy_for(uuid, uuid, uuid)
  to service_role;

create or replace function public.attendance_policy_snapshot(
  p_policy public.attendance_policies
)
returns jsonb
language sql
immutable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'sources', jsonb_build_object(
      'manual', coalesce((p_policy).manual_enabled, true),
      'admin', true,
      'geofence', coalesce((p_policy).geofence_enabled, false),
      'qr', coalesce((p_policy).qr_enabled, false),
      'kiosk', coalesce((p_policy).kiosk_enabled, false)
    ),
    'maxLocationAccuracyM', coalesce((p_policy).max_location_accuracy_m, 100),
    'minDwellSeconds', coalesce((p_policy).min_dwell_seconds, 120),
    'requiresConfirmation', coalesce((p_policy).requires_confirmation, true),
    'lateAfterMinutes', (p_policy).late_after_minutes,
    'evidenceRetentionDays', coalesce((p_policy).evidence_retention_days, 14),
    'correctionRole', coalesce((p_policy).correction_role, 'admin')
  )
$$;

revoke all on function public.attendance_policy_snapshot(public.attendance_policies)
  from public, anon, authenticated;
grant execute on function public.attendance_policy_snapshot(public.attendance_policies)
  to service_role;

-- ---------------------------------------------------------------------------
-- Generation
-- ---------------------------------------------------------------------------
--
-- The 0055 generator with two changes. The campus an occurrence records, and
-- the position it snapshots, come from `attendance_effective_campus`. And an
-- occurrence left behind by a deleted copy of the same service time is
-- re-attached instead of duplicated. The instant
-- is still resolved by `AT TIME ZONE` in the schedule campus's zone, falling
-- back to the church's, exactly as before. The zone deliberately does not
-- follow the effective campus: a church-wide service time has always resolved
-- in the church's zone, and moving it would shift existing services by the
-- difference between two settings nobody thought were connected.

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
  policy public.attendance_policies;
  local_start timestamp;
  resolved_start timestamptz;
  resolved_end timestamptz;
  zone text;
  place uuid;
  place_latitude numeric(9, 6);
  place_longitude numeric(9, 6);
  place_radius integer;
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
           ch.timezone as church_timezone
      from public.church_service_times s
      join public.churches ch on ch.id = s.church_id
      left join public.church_campuses c
        on c.id = s.campus_id and c.is_active
     where s.church_id = p_church_id
  loop
    zone := coalesce(st.campus_timezone, st.church_timezone, 'America/New_York');

    policy := public.attendance_policy_for(p_church_id, st.campus_id, st.id);

    place := public.attendance_effective_campus(p_church_id, st.campus_id);
    place_latitude := null;
    place_longitude := null;
    place_radius := null;
    select c.latitude, c.longitude, c.geofence_radius_m
      into place_latitude, place_longitude, place_radius
      from public.church_campuses c
     where c.id = place and c.church_id = p_church_id and c.is_active;

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

        -- A service time deleted and added back (the website editor does this
        -- when a row is removed and retyped) leaves the earlier occurrence of
        -- this exact service behind with no schedule. Re-attach it rather than
        -- create a second copy of the same service beside it.
        update public.service_occurrences o
           set service_time_id = st.id,
               updated_at = p_now
         where o.id = (
                 select x.id
                   from public.service_occurrences x
                  where x.church_id = st.church_id
                    and x.service_time_id is null
                    and x.generation_source = 'schedule'
                    and x.status <> 'cancelled'
                    and x.starts_at_utc = resolved_start
                    and x.label = st.label
                  order by x.created_at, x.id
                  limit 1
               )
           and not exists (
                 select 1
                   from public.service_occurrences y
                  where y.service_time_id = st.id
                    and y.starts_at_utc = resolved_start
               );

        if found then
          skipped_count := skipped_count + 1;
          day := day + 1;
          continue;
        end if;

        insert into public.service_occurrences (
          church_id, campus_id, service_time_id, label, local_service_date, timezone,
          starts_at_utc, ends_at_utc,
          checkin_opens_at_utc, checkin_closes_at_utc,
          status, generation_source,
          policy_version, policy_snapshot,
          campus_latitude, campus_longitude, geofence_radius_m
        ) values (
          st.church_id, place, st.id, st.label, day, zone,
          resolved_start, resolved_end,
          resolved_start - make_interval(mins => coalesce(policy.checkin_opens_minutes_before, 30)),
          resolved_end + make_interval(mins => coalesce(policy.checkin_closes_minutes_after, 30)),
          'scheduled', 'schedule',
          coalesce(policy.policy_version, 1),
          public.attendance_policy_snapshot(policy),
          place_latitude, place_longitude, place_radius
        )
        on conflict (service_time_id, starts_at_utc)
          where service_time_id is not null
        do nothing
        returning id into inserted;

        if inserted is not null then
          created_count := created_count + 1;
          inserted := null;
        else
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

-- A one-off service. Unchanged from 0055 except that a service with no campus
-- snapshots the position of the campus it effectively happens at. Its recorded
-- campus stays what the person creating it chose.

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
  policy public.attendance_policies;
  place uuid;
  new_id uuid;
begin
  if not exists (select 1 from pg_timezone_names where name = p_timezone) then
    raise exception 'invalid IANA timezone: %', p_timezone
      using errcode = 'check_violation';
  end if;

  resolved_start := ((p_local_date + p_start_time)::timestamp) at time zone p_timezone;
  resolved_end := resolved_start + make_interval(mins => greatest(p_duration_minutes, 15));

  policy := public.attendance_policy_for(p_church_id, p_campus_id, null);
  place := public.attendance_effective_campus(p_church_id, p_campus_id);

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
    public.attendance_policy_snapshot(policy),
    cc.latitude, cc.longitude, cc.geofence_radius_m, p_actor_user_id
  from (select 1) as _
  left join public.church_campuses cc
    on cc.id = place and cc.church_id = p_church_id and cc.is_active
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
-- Refresh what has not happened yet
-- ---------------------------------------------------------------------------
--
-- Every occurrence of this church that is still `scheduled` and whose check-in
-- has **not opened** is brought in line with the church's current setup:
--
--   - A schedule occurrence whose service time was deleted, moved to another
--     day, or moved to another start instant (including a changed time zone)
--     no longer describes a real service. It is deleted when nothing at all
--     references it, and cancelled with reason `schedule_changed` otherwise,
--     so an attempt row is never orphaned. The generator then creates the
--     service at its new time.
--   - Every other one is re-derived in place: label, end, campus, check-in
--     window, policy version and snapshot, and the campus position.
--
-- Nothing whose check-in has opened is touched. That is the P6 rule: a policy
-- edited after attendance could begin cannot change how that service is
-- judged. Before check-in opens there is nothing to judge, so bringing the
-- snapshot up to date is not a rewrite of history but the absence of a stale
-- one.
--
-- Idempotent: an occurrence already in line is not updated, so a second call
-- reports nothing refreshed.

create or replace function public.refresh_upcoming_service_occurrences(
  p_church_id uuid,
  p_now timestamptz default now()
)
returns table (refreshed integer, retired integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  occ public.service_occurrences%rowtype;
  st record;
  schedule_found boolean;
  policy public.attendance_policies;
  zone text;
  place uuid;
  place_latitude numeric(9, 6);
  place_longitude numeric(9, 6);
  place_radius integer;
  next_label text;
  next_start timestamptz;
  next_end timestamptz;
  next_opens timestamptz;
  next_closes timestamptz;
  next_snapshot jsonb;
  referenced boolean;
  touched integer;
  refreshed_count integer := 0;
  retired_count integer := 0;
begin
  for occ in
    select o.*
      from public.service_occurrences o
     where o.church_id = p_church_id
       and o.status = 'scheduled'
       and o.checkin_opens_at_utc > p_now
     order by o.starts_at_utc, o.id
     for update
  loop
    if occ.generation_source = 'schedule' then
      select s.id, s.label, s.day_of_week, s.start_time, s.end_time, s.campus_id,
             c.timezone as campus_timezone,
             ch.timezone as church_timezone
        into st
        from public.church_service_times s
        join public.churches ch on ch.id = s.church_id
        left join public.church_campuses c
          on c.id = s.campus_id and c.is_active
       where s.id = occ.service_time_id
         and s.church_id = p_church_id;
      schedule_found := found;

      if schedule_found then
        zone := coalesce(st.campus_timezone, st.church_timezone, 'America/New_York');
        next_start := ((occ.local_service_date + st.start_time)::timestamp) at time zone zone;
      end if;

      if not schedule_found
         or extract(dow from occ.local_service_date)::integer <> st.day_of_week
         or next_start <> occ.starts_at_utc
      then
        referenced :=
          exists (select 1 from public.attendance_attempts a where a.service_occurrence_id = occ.id)
          or exists (select 1 from public.attendance_facts f where f.service_occurrence_id = occ.id)
          or exists (select 1 from public.attendance_corrections r where r.service_occurrence_id = occ.id)
          or exists (select 1 from public.attendance_detections d where d.service_occurrence_id = occ.id)
          or exists (select 1 from public.attendance_checkin_sessions s where s.service_occurrence_id = occ.id)
          or exists (select 1 from public.attendance_kiosk_sessions k where k.service_occurrence_id = occ.id);

        if referenced then
          -- Detached from the schedule as well as cancelled: it no longer
          -- belongs to that service time, and keeping the link would stop the
          -- generator creating the service again if the time is changed back.
          update public.service_occurrences
             set status = 'cancelled',
                 service_time_id = null,
                 cancelled_at = p_now,
                 cancellation_reason = 'schedule_changed',
                 updated_at = p_now
           where id = occ.id;
        else
          delete from public.service_occurrences where id = occ.id;
        end if;

        retired_count := retired_count + 1;
        continue;
      end if;

      next_label := st.label;
      next_end := ((occ.local_service_date + coalesce(st.end_time, st.start_time + interval '90 minutes'))::timestamp)
                  at time zone zone;
      if next_end <= next_start then
        next_end := next_end + interval '1 day';
      end if;

      policy := public.attendance_policy_for(p_church_id, st.campus_id, st.id);
      place := public.attendance_effective_campus(p_church_id, st.campus_id);
      next_opens := next_start - make_interval(mins => coalesce(policy.checkin_opens_minutes_before, 30));
      next_closes := next_end + make_interval(mins => coalesce(policy.checkin_closes_minutes_after, 30));
    else
      -- A manual service keeps the times and window its creator chose. Only
      -- the policy and the position it will be judged against are refreshed.
      next_label := occ.label;
      next_start := occ.starts_at_utc;
      next_end := occ.ends_at_utc;
      next_opens := occ.checkin_opens_at_utc;
      next_closes := occ.checkin_closes_at_utc;
      policy := public.attendance_policy_for(p_church_id, occ.campus_id, null);
      place := occ.campus_id;
    end if;

    place_latitude := null;
    place_longitude := null;
    place_radius := null;
    select c.latitude, c.longitude, c.geofence_radius_m
      into place_latitude, place_longitude, place_radius
      from public.church_campuses c
     where c.id = public.attendance_effective_campus(p_church_id, place)
       and c.church_id = p_church_id
       and c.is_active;

    next_snapshot := public.attendance_policy_snapshot(policy);

    update public.service_occurrences o
       set label = next_label,
           campus_id = place,
           ends_at_utc = next_end,
           checkin_opens_at_utc = next_opens,
           checkin_closes_at_utc = next_closes,
           policy_version = coalesce(policy.policy_version, 1),
           policy_snapshot = next_snapshot,
           campus_latitude = place_latitude,
           campus_longitude = place_longitude,
           geofence_radius_m = place_radius,
           updated_at = p_now
     where o.id = occ.id
       and (
         o.label is distinct from next_label
         or o.campus_id is distinct from place
         or o.ends_at_utc is distinct from next_end
         or o.checkin_opens_at_utc is distinct from next_opens
         or o.checkin_closes_at_utc is distinct from next_closes
         or o.policy_version is distinct from coalesce(policy.policy_version, 1)
         or o.policy_snapshot is distinct from next_snapshot
         or o.campus_latitude is distinct from place_latitude
         or o.campus_longitude is distinct from place_longitude
         or o.geofence_radius_m is distinct from place_radius
       );
    get diagnostics touched = row_count;
    refreshed_count := refreshed_count + touched;
  end loop;

  return query select refreshed_count, retired_count;
end;
$$;

revoke all on function public.refresh_upcoming_service_occurrences(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.refresh_upcoming_service_occurrences(uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- Detections do not outlive their purpose
-- ---------------------------------------------------------------------------
--
-- A detection says an account arrived at a campus at a server instant. It
-- exists to measure dwell and is useless once it expires (two hours after it
-- opened), confirmed or not. 0058 indexed `expires_at` for a purge that no job
-- ever ran; this is that purge. Bounded per call so a backlog cannot hold a
-- long lock.

create or replace function public.purge_expired_attendance_detections(
  p_now timestamptz default now(),
  p_limit integer default 5000
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  removed integer;
begin
  delete from public.attendance_detections d
   where d.id in (
     select x.id
       from public.attendance_detections x
      where x.expires_at <= p_now
      order by x.expires_at
      limit greatest(1, least(coalesce(p_limit, 5000), 50000))
   );
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function public.purge_expired_attendance_detections(timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.purge_expired_attendance_detections(timestamptz, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- Withdrawing consent stops the evidence, not the history
-- ---------------------------------------------------------------------------
--
-- Called when an account sets automatic attendance consent to anything other
-- than `granted`. Every detection the account holds is deleted, so no dwell
-- that started before the withdrawal can be confirmed after it. A geofence
-- attempt still waiting on dwell is closed as `expired` / `consent_revoked`,
-- and any precise evidence on the account's geofence attempts is emptied.
--
-- Counted facts are untouched, and so are the attempts that produced them:
-- attendance counted while consent was given happened, and withdrawing consent
-- is not a claim that it did not (P6_PRIVACY_AND_ABUSE_MODEL.md).

create or replace function public.withdraw_automatic_attendance_evidence(
  p_account_id uuid,
  p_now timestamptz default now()
)
returns table (detections_removed integer, attempts_closed integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  removed integer;
  closed integer;
begin
  delete from public.attendance_detections
   where account_id = p_account_id;
  get diagnostics removed = row_count;

  update public.attendance_attempts
     set status = 'expired',
         result_reason = 'consent_revoked',
         precise_evidence = null,
         evidence_expires_at = null
   where account_id = p_account_id
     and source = 'geofence'
     and status = 'pending_confirmation';
  get diagnostics closed = row_count;

  update public.attendance_attempts
     set precise_evidence = null,
         evidence_expires_at = null
   where account_id = p_account_id
     and source = 'geofence'
     and precise_evidence is not null;

  return query select removed, closed;
end;
$$;

revoke all on function public.withdraw_automatic_attendance_evidence(uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.withdraw_automatic_attendance_evidence(uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- Who changed the check-in setup
-- ---------------------------------------------------------------------------
--
-- Append-only. "Who turned automatic check-in off, and when" is a question a
-- church asks. The before and after values are the setting itself (a policy
-- row, a campus position a church publishes anyway, a list of service times),
-- never anything about a person who attends.

create table if not exists public.attendance_setup_events (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null
    check (action in ('policy_updated', 'campus_location_updated', 'service_times_updated')),
  target_id uuid,
  previous jsonb,
  next jsonb,
  created_at timestamptz not null default now()
);

create index if not exists attendance_setup_events_church_idx
  on public.attendance_setup_events (church_id, created_at desc);

alter table public.attendance_setup_events enable row level security;

revoke all on table public.attendance_setup_events from public, anon, authenticated;
grant select, insert on table public.attendance_setup_events to service_role;

notify pgrst, 'reload schema';
