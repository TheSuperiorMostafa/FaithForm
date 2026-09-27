-- Release every selected child together after locking and validating the whole
-- selection. The server verifies pickup tickets before calling this function;
-- only the server role may execute it.
create or replace function public.release_checkin_sessions(
  p_church_id uuid,
  p_session_ids uuid[],
  p_expected_household_id uuid,
  p_method text,
  p_released_to_member_id uuid,
  p_override_reason text,
  p_actor_user_id uuid
)
returns integer
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_selected integer;
  v_unique integer;
  v_households integer;
  v_null_households integer;
  v_household_id uuid;
  v_member_ids uuid[];
  v_updated integer;
begin
  if p_church_id is null or p_actor_user_id is null or p_session_ids is null
     or cardinality(p_session_ids) < 1 or cardinality(p_session_ids) > 100
     or p_method is null or p_method not in ('code', 'qr', 'override') then
    raise exception 'Invalid checkout request' using errcode = '22023';
  end if;

  select count(distinct id) into v_unique from unnest(p_session_ids) as selected(id);
  if v_unique <> cardinality(p_session_ids) then
    raise exception 'Repeated or missing session' using errcode = '22023';
  end if;

  if p_method = 'override' then
    if length(btrim(coalesce(p_override_reason, ''))) < 4 then
      raise exception 'Override reason required' using errcode = '22023';
    end if;
  elsif p_expected_household_id is null or p_released_to_member_id is null then
    raise exception 'Pickup credential required' using errcode = '22023';
  end if;

  -- A second volunteer attempting the same release waits here, then sees the
  -- changed status and aborts. The later update is part of this transaction.
  select count(*), count(distinct s.household_id),
         count(*) filter (where s.household_id is null),
         (array_agg(s.household_id))[1], array_agg(s.member_id)
    into v_selected, v_households, v_null_households, v_household_id, v_member_ids
    from (
      select member_id, household_id
        from public.checkin_sessions
       where church_id = p_church_id
         and id = any(p_session_ids)
         and status in ('pre_checked_in', 'checked_in')
       order by id
       for update
    ) s;

  if v_selected <> cardinality(p_session_ids) or v_households <> 1
     or v_null_households <> 0 then
    raise exception 'Selected check-ins changed' using errcode = '22023';
  end if;
  if p_expected_household_id is not null and v_household_id <> p_expected_household_id then
    raise exception 'Pickup household mismatch' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(v_member_ids) as selected(member_id)
     where not exists (
       select 1 from public.household_members hm
        where hm.church_id = p_church_id
          and hm.member_id = selected.member_id
          and hm.relationship = 'dependent'
        for share
     )
  ) then
    raise exception 'Only dependents may be released' using errcode = '22023';
  end if;

  if p_released_to_member_id is not null and not (
    exists (
      select 1 from public.household_members hm
       where hm.church_id = p_church_id
         and hm.household_id = v_household_id
         and hm.member_id = p_released_to_member_id
         and hm.relationship = 'guardian'
       for share
    )
    or exists (
      select 1 from public.household_pickup_authorizations pa
       where pa.church_id = p_church_id
         and pa.household_id = v_household_id
         and pa.member_id = p_released_to_member_id
         and pa.is_active = true
         and pa.revoked_at is null
       for share
    )
  ) then
    raise exception 'Pickup person is not authorized' using errcode = '22023';
  end if;

  update public.checkin_sessions
     set status = 'checked_out',
         checked_out_at = now(),
         checked_out_by = p_actor_user_id,
         checkout_method = p_method,
         checkout_released_to_member_id = p_released_to_member_id,
         checkout_override_reason = case when p_method = 'override' then btrim(p_override_reason) else null end
   where church_id = p_church_id
     and id = any(p_session_ids)
     and status in ('pre_checked_in', 'checked_in');
  get diagnostics v_updated = row_count;
  if v_updated <> cardinality(p_session_ids) then
    raise exception 'Selected check-ins changed while releasing' using errcode = '22023';
  end if;

  return v_updated;
end;
$$;

revoke all on function public.release_checkin_sessions(uuid, uuid[], uuid, text, uuid, text, uuid)
  from public, anon, authenticated;
grant execute on function public.release_checkin_sessions(uuid, uuid[], uuid, text, uuid, text, uuid)
  to service_role;

notify pgrst, 'reload schema';
