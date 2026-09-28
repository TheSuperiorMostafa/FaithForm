-- Save a gathering, its existing attendance window, and its audit event in one
-- transaction. The caller checks staff/leader authorization before using the
-- service-role connection; browser roles cannot execute this function.
create or replace function public.update_group_gathering(
  p_church_id uuid,
  p_group_id uuid,
  p_event_id uuid,
  p_actor_user_id uuid,
  p_actor_type text,
  p_title text,
  p_description text,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_timezone text,
  p_location_name text,
  p_location_address text,
  p_online_meeting_url text
)
returns text
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_event public.group_events%rowtype;
  v_occurrence public.service_occurrences%rowtype;
  v_has_attendance boolean;
begin
  if p_actor_type not in ('staff', 'leader') then
    raise exception 'invalid actor' using errcode = 'check_violation';
  end if;

  -- Attendance recording takes this same lock before creating or updating its
  -- occurrence, so it cannot race a meeting edit past the history check.
  select * into v_event from public.group_events
   where id = p_event_id and church_id = p_church_id and group_id = p_group_id
   for update;
  if not found then
    return 'not_found';
  end if;
  if v_event.status = 'cancelled' then
    return 'cancelled';
  end if;

  select * into v_occurrence from public.service_occurrences
   where group_event_id = p_event_id and church_id = p_church_id
   for update;
  if found then
    select exists (
      select 1 from public.attendance_facts
       where service_occurrence_id = v_occurrence.id
    ) or exists (
      select 1 from public.group_attendance_records
       where occurrence_id = v_occurrence.id or event_id = p_event_id
    ) into v_has_attendance;

    -- A recorded attendance window is history even when the saved roster and
    -- guest headcount are both zero.
    if v_has_attendance and (
      v_event.starts_at is distinct from p_starts_at or
      v_event.ends_at is distinct from p_ends_at or
      v_event.timezone is distinct from p_timezone
    ) then
      return 'attendance_locked';
    end if;
  end if;

  update public.group_events set
    title = p_title,
    description = p_description,
    starts_at = p_starts_at,
    ends_at = p_ends_at,
    timezone = p_timezone,
    location_name = p_location_name,
    location_address = p_location_address,
    online_meeting_url = p_online_meeting_url,
    is_modified = true,
    updated_by = p_actor_user_id
   where id = p_event_id and church_id = p_church_id and group_id = p_group_id;

  if v_occurrence.id is not null and not v_has_attendance then
    update public.service_occurrences set
      label = left(p_title, 200),
      local_service_date = (p_starts_at at time zone p_timezone)::date,
      starts_at_utc = p_starts_at,
      ends_at_utc = p_ends_at,
      checkin_opens_at_utc = p_starts_at - interval '1 day',
      checkin_closes_at_utc = p_ends_at + interval '30 days',
      timezone = p_timezone,
      updated_at = now()
     where id = v_occurrence.id and church_id = p_church_id;
    if not found then
      raise exception 'attendance occurrence disappeared' using errcode = 'data_exception';
    end if;
  end if;

  perform public.log_group_event(
    p_church_id, p_group_id, 'event_updated', p_actor_type, p_actor_user_id,
    null, null, null, jsonb_build_object('eventId', p_event_id)
  );
  return 'updated';
end;
$$;

revoke all on function public.update_group_gathering(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text
) from public, anon, authenticated;
grant execute on function public.update_group_gathering(
  uuid, uuid, uuid, uuid, text, text, text, timestamptz, timestamptz,
  text, text, text, text
) to service_role;

notify pgrst, 'reload schema';
