-- Undo a multi-child check-in only if every selected child is still eligible.
-- Locking and updating in one transaction prevents a partial family undo.
create or replace function public.undo_checkin_sessions(
  p_church_id uuid,
  p_session_ids uuid[],
  p_actor_user_id uuid
)
returns integer
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_unique integer;
  v_selected integer;
  v_eligible integer;
  v_updated integer;
  v_cutoff timestamptz := now() - interval '10 minutes';
begin
  if p_church_id is null or p_actor_user_id is null or p_session_ids is null
     or cardinality(p_session_ids) < 1 or cardinality(p_session_ids) > 20 then
    raise exception 'Invalid undo request' using errcode = '22023';
  end if;
  select count(distinct id) into v_unique from unnest(p_session_ids) as selected(id);
  if v_unique <> cardinality(p_session_ids) then
    raise exception 'Repeated or missing session' using errcode = '22023';
  end if;

  select count(*), count(*) filter (
           where s.status = 'checked_in'
             and s.checked_out_at is null
             and s.checked_in_by = p_actor_user_id
             and s.checked_in_at >= v_cutoff
         )
    into v_selected, v_eligible
    from (
      select status, checked_out_at, checked_in_by, checked_in_at
        from public.checkin_sessions
       where church_id = p_church_id and id = any(p_session_ids)
       order by id
       for update
    ) s;
  if v_selected <> cardinality(p_session_ids) or v_eligible <> v_selected then
    raise exception 'Selected check-ins changed' using errcode = '22023';
  end if;

  update public.checkin_sessions
     set status = 'cancelled'
   where church_id = p_church_id
     and id = any(p_session_ids)
     and status = 'checked_in'
     and checked_out_at is null
     and checked_in_by = p_actor_user_id
     and checked_in_at >= v_cutoff;
  get diagnostics v_updated = row_count;
  if v_updated <> cardinality(p_session_ids) then
    raise exception 'Selected check-ins changed while undoing' using errcode = '22023';
  end if;
  return v_updated;
end;
$$;

revoke all on function public.undo_checkin_sessions(uuid, uuid[], uuid)
  from public, anon, authenticated;
grant execute on function public.undo_checkin_sessions(uuid, uuid[], uuid)
  to service_role;

notify pgrst, 'reload schema';
