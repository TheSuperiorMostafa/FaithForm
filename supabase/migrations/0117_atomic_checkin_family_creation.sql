-- Create a first-time family and all its People links in one transaction.
-- The subsequent physical check-ins remain separate and report per child.
create or replace function public.create_checkin_family(
  p_church_id uuid,
  p_actor_user_id uuid,
  p_family_name text,
  p_guardian_first_name text,
  p_guardian_last_name text,
  p_guardian_phone text,
  p_children jsonb
)
returns jsonb
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_parent_id uuid;
  v_household_id uuid;
  v_child_id uuid;
  v_location_id uuid;
  v_child jsonb;
  v_children jsonb := '[]'::jsonb;
begin
  if p_church_id is null or p_actor_user_id is null
     or length(btrim(coalesce(p_family_name, ''))) = 0
     or length(btrim(coalesce(p_guardian_first_name, ''))) = 0
     or length(btrim(coalesce(p_guardian_last_name, ''))) = 0
     or jsonb_typeof(p_children) is distinct from 'array'
     or jsonb_array_length(p_children) < 1 or jsonb_array_length(p_children) > 10 then
    raise exception 'Invalid family request' using errcode = '22023';
  end if;

  -- Serialize first-time entry of the same phone number at two desks. This
  -- applies to this command; the initial application check stays for wording.
  if nullif(btrim(coalesce(p_guardian_phone, '')), '') is not null then
    perform pg_advisory_xact_lock(hashtextextended(
      p_church_id::text || ':' || btrim(p_guardian_phone), 0
    ));
    if exists (
      select 1 from public.members
       where church_id = p_church_id and phone = btrim(p_guardian_phone)
    ) then
      raise exception 'Parent phone already belongs to a person' using errcode = '23505';
    end if;
  end if;

  insert into public.members (church_id, first_name, last_name, phone, email, is_active)
  values (p_church_id, btrim(p_guardian_first_name), btrim(p_guardian_last_name),
          nullif(btrim(coalesce(p_guardian_phone, '')), ''), null, true)
  returning id into v_parent_id;

  insert into public.households (church_id, name, created_by)
  values (p_church_id, btrim(p_family_name), p_actor_user_id)
  returning id into v_household_id;

  insert into public.household_members
    (church_id, household_id, member_id, relationship, is_primary_contact, created_by)
  values (p_church_id, v_household_id, v_parent_id, 'guardian', true, p_actor_user_id);

  for v_child in select value from jsonb_array_elements(p_children) loop
    if jsonb_typeof(v_child) is distinct from 'object'
       or length(btrim(coalesce(v_child->>'firstName', ''))) = 0
       or length(btrim(coalesce(v_child->>'lastName', ''))) = 0 then
      raise exception 'Invalid child' using errcode = '22023';
    end if;

    v_location_id := (v_child->>'locationId')::uuid;
    perform 1 from public.church_locations
     where id = v_location_id and church_id = p_church_id and is_active = true
     for share;
    if not found then
      raise exception 'Child room is closed or missing' using errcode = '22023';
    end if;

    insert into public.members
      (church_id, first_name, last_name, is_active, medical_notes, default_location_id)
    values (
      p_church_id, btrim(v_child->>'firstName'), btrim(v_child->>'lastName'),
      true, nullif(btrim(coalesce(v_child->>'medicalNotes', '')), ''), v_location_id
    )
    returning id into v_child_id;

    insert into public.household_members
      (church_id, household_id, member_id, relationship, is_primary_contact, created_by)
    values (p_church_id, v_household_id, v_child_id, 'dependent', false, p_actor_user_id);

    v_children := v_children || jsonb_build_array(jsonb_build_object(
      'memberId', v_child_id,
      'firstName', btrim(v_child->>'firstName'),
      'lastName', btrim(v_child->>'lastName'),
      'locationId', v_location_id
    ));
  end loop;

  return jsonb_build_object('householdId', v_household_id, 'children', v_children);
end;
$$;

revoke all on function public.create_checkin_family(uuid, uuid, text, text, text, text, jsonb)
  from public, anon, authenticated;
grant execute on function public.create_checkin_family(uuid, uuid, text, text, text, text, jsonb)
  to service_role;

notify pgrst, 'reload schema';
