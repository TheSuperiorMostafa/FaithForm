-- Faithful: transactional bulk attendance
-- Migration 0056 (Prompt 6 completion)
--
-- Additive. Depends on 0055.
--
-- Bulk marking previously issued one network request per person from the
-- dashboard. That was wrong in three ways: it could partially apply if the
-- browser was closed or the network dropped mid-run, it made a 400-person
-- roster 400 round trips, and it pushed batch semantics into the client where
-- they could not be enforced.
--
-- This function fixes all three without creating a second insert path. It is a
-- *wrapper*: every person still goes through `record_attendance`, so the
-- validation, the attempt audit, the idempotency and the unique counted fact
-- are exactly the same as a single check-in.
--
-- Transaction semantics, stated precisely because they are the point:
--
--   * The whole batch is one transaction. An unexpected system failure — a
--     constraint nobody anticipated, a dead connection — rolls back every
--     person, so there is never a half-marked roster.
--   * An *expected* per-person outcome is not a failure. `already_counted`,
--     `too_late`, `member_not_in_church` are answers, not errors: they are
--     returned for that person and the rest of the batch still commits.
--
-- That distinction is what the old header/entry model could not express.

create or replace function public.record_attendance_batch(
  p_occurrence_id uuid,
  p_member_ids uuid[],
  p_source text,
  p_actor_type text,
  p_batch_key text,
  p_actor_user_id uuid default null,
  p_now timestamptz default now()
)
returns table (
  member_id uuid,
  outcome text,
  reason text,
  fact_id uuid,
  attempt_id uuid
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  target uuid;
  seen uuid[] := '{}';
  result record;
  member_count integer;
begin
  member_count := coalesce(array_length(p_member_ids, 1), 0);

  if member_count = 0 then
    return;
  end if;

  -- Bounded. A batch larger than this is a mistake or an attack, and either way
  -- it must not hold a transaction open long enough to matter.
  if member_count > 1000 then
    raise exception 'batch too large: %', member_count
      using errcode = 'check_violation';
  end if;

  -- The occurrence must exist before any person is processed, so a bad id
  -- fails the whole call rather than producing a thousand identical rejections.
  if not exists (select 1 from public.service_occurrences where id = p_occurrence_id) then
    raise exception 'occurrence not found' using errcode = 'no_data_found';
  end if;

  foreach target in array p_member_ids loop
    -- The same person twice in one request is the caller's mistake, not a
    -- second attendance. Skipping keeps the per-person result set one row per
    -- distinct person, which is what a caller can actually act on.
    if target = any (seen) then
      continue;
    end if;
    seen := seen || target;

    -- Delegated, never re-implemented. This is the same command a geofence
    -- attempt calls, so the unique counted fact and the attempt audit apply
    -- identically.
    --
    -- The idempotency key is derived per person from the batch key, so
    -- re-running the same batch finds each person's own earlier attempt rather
    -- than creating a second one.
    select * into result
    from public.record_attendance(
      p_occurrence_id := p_occurrence_id,
      p_member_id := target,
      p_source := p_source,
      p_actor_type := p_actor_type,
      p_idempotency_key := p_batch_key || ':' || target::text,
      p_account_id := null,
      p_actor_user_id := p_actor_user_id,
      p_observed_at := null,
      p_distance_band := null,
      p_accuracy_band := null,
      p_dwell_seconds := null,
      p_precise_evidence := null,
      p_now := p_now
    );

    member_id := target;
    outcome := result.outcome;
    reason := result.reason;
    fact_id := result.fact_id;
    attempt_id := result.attempt_id;
    return next;
  end loop;

  return;
end;
$$;

revoke all on function public.record_attendance_batch(
  uuid, uuid[], text, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_attendance_batch(
  uuid, uuid[], text, text, text, uuid, timestamptz
) to service_role;

notify pgrst, 'reload schema';
