-- Save the church profile, legacy mirrors, and all child rows in one database
-- transaction. The caller is the authenticated platform-admin server action;
-- browser roles cannot execute this function directly.
create or replace function public.save_church_profile(
  p_church_id uuid,
  p_church jsonb,
  p_services jsonb,
  p_staff jsonb,
  p_events jsonb
)
returns void
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_item jsonb;
  v_id uuid;
  v_written uuid;
  v_service_ids uuid[] := '{}'::uuid[];
  v_staff_ids uuid[] := '{}'::uuid[];
  v_event_ids uuid[] := '{}'::uuid[];
begin
  if jsonb_typeof(p_church) <> 'object'
     or jsonb_typeof(p_services) <> 'array'
     or jsonb_typeof(p_staff) <> 'array'
     or jsonb_typeof(p_events) <> 'array' then
    raise exception 'Invalid church profile payload' using errcode = '22023';
  end if;

  -- Serializes two editors saving the same church at once. A later failure in
  -- any statement below rolls back the parent update and all child changes.
  perform 1 from public.churches where id = p_church_id for update;
  if not found then
    raise exception 'Church not found' using errcode = 'P0002';
  end if;

  update public.churches set
    name = p_church->>'name',
    tagline = p_church->>'tagline',
    mission_statement = p_church->>'mission_statement',
    vision_statement = p_church->>'vision_statement',
    description = p_church->>'description',
    logo_url = p_church->>'logo_url',
    cover_image_url = p_church->>'cover_image_url',
    giving_primary_color = p_church->>'giving_primary_color',
    giving_accent_color = p_church->>'giving_accent_color',
    address = p_church->>'address',
    city = p_church->>'city',
    state = p_church->>'state',
    zip = p_church->>'zip',
    phone = p_church->>'phone',
    email = p_church->>'email',
    website = p_church->>'website',
    google_maps_url = p_church->>'google_maps_url',
    timezone = coalesce(nullif(p_church->>'timezone', ''), 'America/New_York'),
    denomination = p_church->>'denomination',
    office_hours = coalesce(p_church->'office_hours', '{}'::jsonb),
    holiday_schedule = p_church->>'holiday_schedule',
    facebook_url = p_church->>'facebook_url',
    instagram_url = p_church->>'instagram_url',
    youtube_url = p_church->>'youtube_url',
    tiktok_url = p_church->>'tiktok_url',
    x_url = p_church->>'x_url',
    podcast_url = p_church->>'podcast_url',
    livestream_url = p_church->>'livestream_url',
    announcement_facebook_post_time = (p_church->>'announcement_facebook_post_time')::time,
    ai_knowledge = coalesce(p_church->'ai_knowledge', '{}'::jsonb)
  where id = p_church_id;

  insert into public.church_settings (church_id, denomination, updated_at)
  values (p_church_id, p_church->>'denomination', now())
  on conflict (church_id) do update set
    denomination = excluded.denomination,
    updated_at = excluded.updated_at;

  insert into public.voice_assistant_settings
    (church_id, church_phone, office_hours, denomination, updated_at)
  values
    (p_church_id, p_church->>'phone', coalesce(p_church->'office_hours', '{}'::jsonb),
     p_church->>'denomination', now())
  on conflict (church_id) do update set
    church_phone = excluded.church_phone,
    office_hours = excluded.office_hours,
    denomination = excluded.denomination,
    updated_at = excluded.updated_at;

  for v_item in select value from jsonb_array_elements(p_services) loop
    v_id := (v_item->>'id')::uuid;
    if v_id is null or v_id = any(v_service_ids) then
      raise exception 'Duplicate or missing service-time ID' using errcode = '22023';
    end if;
    if coalesce((v_item->>'is_existing')::boolean, false)
       and not exists (select 1 from public.church_service_times
                        where id = v_id and church_id = p_church_id) then
      raise exception 'Service time changed since the form opened' using errcode = 'P0002';
    end if;
    v_service_ids := array_append(v_service_ids, v_id);
    v_written := null;
    insert into public.church_service_times
      (id, church_id, label, day_of_week, start_time, end_time, kind, notes, sort_order, updated_at)
    values
      (v_id, p_church_id, v_item->>'label', (v_item->>'day_of_week')::smallint,
       (v_item->>'start_time')::time, nullif(v_item->>'end_time', '')::time,
       v_item->>'kind', v_item->>'notes', (v_item->>'sort_order')::integer, now())
    on conflict (id) do update set
      label = excluded.label,
      day_of_week = excluded.day_of_week,
      start_time = excluded.start_time,
      end_time = excluded.end_time,
      kind = excluded.kind,
      notes = excluded.notes,
      sort_order = excluded.sort_order,
      updated_at = now()
    where church_service_times.church_id = p_church_id
    returning id into v_written;
    if v_written is null then
      raise exception 'Service time belongs to another church' using errcode = '42501';
    end if;
  end loop;
  delete from public.church_service_times
   where church_id = p_church_id and not (id = any(v_service_ids));

  for v_item in select value from jsonb_array_elements(p_staff) loop
    v_id := (v_item->>'id')::uuid;
    if v_id is null or v_id = any(v_staff_ids) then
      raise exception 'Duplicate or missing staff ID' using errcode = '22023';
    end if;
    if coalesce((v_item->>'is_existing')::boolean, false)
       and not exists (select 1 from public.church_staff
                        where id = v_id and church_id = p_church_id) then
      raise exception 'Staff entry changed since the form opened' using errcode = 'P0002';
    end if;
    v_staff_ids := array_append(v_staff_ids, v_id);
    v_written := null;
    insert into public.church_staff
      (id, church_id, full_name, title, email, phone, photo_url, bio,
       is_senior_pastor, is_executive_pastor, ai_contact_priority, is_public,
       sort_order, updated_at)
    values
      (v_id, p_church_id, v_item->>'full_name', v_item->>'title',
       v_item->>'email', v_item->>'phone', v_item->>'photo_url', v_item->>'bio',
       (v_item->>'is_senior_pastor')::boolean,
       (v_item->>'is_executive_pastor')::boolean,
       (v_item->>'ai_contact_priority')::integer,
       (v_item->>'is_public')::boolean,
       (v_item->>'sort_order')::integer, now())
    on conflict (id) do update set
      full_name = excluded.full_name,
      title = excluded.title,
      email = excluded.email,
      phone = excluded.phone,
      photo_url = excluded.photo_url,
      bio = excluded.bio,
      is_senior_pastor = excluded.is_senior_pastor,
      is_executive_pastor = excluded.is_executive_pastor,
      ai_contact_priority = excluded.ai_contact_priority,
      is_public = excluded.is_public,
      sort_order = excluded.sort_order,
      updated_at = now()
    where church_staff.church_id = p_church_id
    returning id into v_written;
    if v_written is null then
      raise exception 'Staff entry belongs to another church' using errcode = '42501';
    end if;
  end loop;
  delete from public.church_staff
   where church_id = p_church_id and not (id = any(v_staff_ids));

  for v_item in select value from jsonb_array_elements(p_events) loop
    v_id := (v_item->>'id')::uuid;
    if v_id is null or v_id = any(v_event_ids) then
      raise exception 'Duplicate or missing recurring-event ID' using errcode = '22023';
    end if;
    if coalesce((v_item->>'is_existing')::boolean, false)
       and not exists (select 1 from public.church_recurring_events
                        where id = v_id and church_id = p_church_id) then
      raise exception 'Recurring event changed since the form opened' using errcode = 'P0002';
    end if;
    v_event_ids := array_append(v_event_ids, v_id);
    v_written := null;
    insert into public.church_recurring_events
      (id, church_id, name, aliases, cadence, description, audience, tone,
       caption_notes, visual_notes, is_active, sort_order)
    values
      (v_id, p_church_id, v_item->>'name',
       array(select jsonb_array_elements_text(coalesce(v_item->'aliases', '[]'::jsonb))),
       v_item->>'cadence', v_item->>'description', v_item->>'audience',
       v_item->>'tone', v_item->>'caption_notes', v_item->>'visual_notes',
       (v_item->>'is_active')::boolean, (v_item->>'sort_order')::integer)
    on conflict (id) do update set
      name = excluded.name,
      aliases = excluded.aliases,
      cadence = excluded.cadence,
      description = excluded.description,
      audience = excluded.audience,
      tone = excluded.tone,
      caption_notes = excluded.caption_notes,
      visual_notes = excluded.visual_notes,
      is_active = excluded.is_active,
      sort_order = excluded.sort_order
    where church_recurring_events.church_id = p_church_id
    returning id into v_written;
    if v_written is null then
      raise exception 'Recurring event belongs to another church' using errcode = '42501';
    end if;
  end loop;
  delete from public.church_recurring_events
   where church_id = p_church_id and not (id = any(v_event_ids));
end;
$$;

revoke all on function public.save_church_profile(uuid, jsonb, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function public.save_church_profile(uuid, jsonb, jsonb, jsonb, jsonb)
  to service_role;

notify pgrst, 'reload schema';
