-- Website writes are server-only. The existing actions authenticate church
-- admins before using these SECURITY INVOKER functions. No browser receives
-- EXECUTE; no function elevates the caller's database privileges.
-- Keep the original landing order across repeated layout changes. Existing
-- rows start null; their current order is captured on the next expansion.
alter table public.site_sections add column if not exists landing_sort_order integer;

create or replace function public.create_site_draft(p_church_id uuid, p_theme text, p_draft jsonb, p_contact_email text)
returns boolean language plpgsql security invoker set search_path = public as $$
declare new_page_id uuid;
begin
  perform 1 from public.churches where id=p_church_id for update;
  if not found then raise exception 'Church not found'; end if;
  select id into new_page_id from public.site_pages where church_id=p_church_id and path='/';
  if new_page_id is not null and (
    exists(select 1 from public.site_sections where church_id=p_church_id)
    or exists(select 1 from public.site_pages where id=new_page_id and status='published')
    or exists(select 1 from public.site_settings where church_id=p_church_id and is_published)
  ) then return false; end if;
  if not exists(select 1 from public.site_themes where key=p_theme and is_active) then raise exception 'Design unavailable'; end if;
  if jsonb_typeof(p_draft->'sections') is distinct from 'array' or jsonb_array_length(p_draft->'sections')=0 then raise exception 'Sections required'; end if;
  insert into public.site_settings(church_id,theme_key,is_published,layout_mode,contact_email)
    values(p_church_id,p_theme,false,'landing',p_contact_email)
    on conflict(church_id) do update set theme_key=excluded.theme_key,is_published=false,layout_mode='landing';
  if new_page_id is null then
    insert into public.site_pages(church_id,path,title,meta_description,status)
      values(p_church_id,'/',p_draft->>'title',p_draft->>'metaDescription','draft') returning id into new_page_id;
  end if;
  insert into public.site_sections(church_id,page_id,type,sort_order,is_visible,props)
    select p_church_id,new_page_id,s.value->>'type',(s.ordinality::integer-1)*10,
      coalesce((s.value->>'isVisible')::boolean,true),coalesce(s.value->'props','{}'::jsonb)
    from jsonb_array_elements(p_draft->'sections') with ordinality s;
  return true;
end $$;

create or replace function public.set_site_publication(p_church_id uuid, p_published boolean)
-- Preserve the text return contract of the existing hosted publisher.
returns text language plpgsql security invoker set search_path = public as $$
begin
  perform 1 from public.churches where id=p_church_id for update;
  if p_published and not exists(select 1 from public.site_pages p join public.site_sections s on s.page_id=p.id and s.church_id=p.church_id where p.church_id=p_church_id and p.path='/') then raise exception 'Build a website first'; end if;
  update public.site_pages set status=case when p_published then 'published' else 'draft' end where church_id=p_church_id;
  insert into public.site_settings(church_id,is_published) values(p_church_id,p_published)
    on conflict(church_id) do update set is_published=excluded.is_published;
  return case when p_published then 'published' else 'unpublished' end;
end $$;

create or replace function public.reorder_site_sections(p_church_id uuid, p_ids uuid[])
returns void language plpgsql security invoker set search_path = public as $$
declare target_page uuid;
begin
  perform 1 from public.churches where id=p_church_id for update;
  if coalesce(cardinality(p_ids),0)=0 or cardinality(p_ids)<>(select count(distinct id) from unnest(p_ids) id) then raise exception 'Invalid order'; end if;
  select page_id into target_page from public.site_sections where church_id=p_church_id and id=p_ids[1];
  if target_page is null or exists(select 1 from unnest(p_ids) id where not exists(select 1 from public.site_sections s where s.id=id and s.church_id=p_church_id and s.page_id=target_page))
    or cardinality(p_ids)<>(select count(*) from public.site_sections where church_id=p_church_id and page_id=target_page) then raise exception 'Sections changed. Reload the page'; end if;
  update public.site_sections s set sort_order=(o.ordinality::integer-1)*10
    from unnest(p_ids) with ordinality o(id,ordinality) where s.id=o.id and s.church_id=p_church_id;
end $$;

create or replace function public.save_site_section_patch(p_church_id uuid, p_section_id uuid, p_patch jsonb)
returns void language plpgsql security invoker set search_path = public as $$
begin
  perform 1 from public.churches where id=p_church_id for update;
  if not exists(select 1 from public.site_sections s join public.site_pages p on p.id=s.page_id and p.church_id=s.church_id where s.id=p_section_id and s.church_id=p_church_id and s.type<>'custom_embed') then raise exception 'Section unavailable'; end if;
  if jsonb_typeof(p_patch) is distinct from 'object' then raise exception 'Invalid edit'; end if;
  if p_patch='{}'::jsonb then
    delete from public.site_overrides where church_id=p_church_id and scope='section' and section_id=p_section_id;
  else
    insert into public.site_overrides(church_id,scope,section_id,patch) values(p_church_id,'section',p_section_id,p_patch)
      on conflict(section_id) where scope='section' do update set patch=excluded.patch;
  end if;
end $$;

-- The planner supplies only a destination path, order and generated props for
-- each existing row. No rows/pages are deleted: page metadata and overrides
-- survive a round trip. Old page-scoped content is materialized in a section
-- override before moving; narrower section edits keep their precedence.
create or replace function public.apply_site_layout(p_church_id uuid, p_mode text, p_plan jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare item jsonb; destination uuid; current_page uuid; target_path text; home_status text;
begin
  perform 1 from public.churches where id=p_church_id for update;
  if p_mode not in ('landing','website') then raise exception 'Invalid layout'; end if;
  select status into home_status from public.site_pages where church_id=p_church_id and path='/';
  if home_status is null then raise exception 'Home page unavailable'; end if;
  if jsonb_typeof(p_plan) is distinct from 'array' then raise exception 'Invalid layout plan'; end if;
  if jsonb_array_length(p_plan)<>(select count(*) from public.site_sections where church_id=p_church_id)
    or (select count(distinct x->>'id') from jsonb_array_elements(p_plan) x)<>jsonb_array_length(p_plan) then raise exception 'Sections changed. Reload the page'; end if;
  for item in select * from jsonb_array_elements(p_plan) loop
    select page_id into current_page from public.site_sections where id=(item->>'id')::uuid and church_id=p_church_id for update;
    if current_page is null or not exists(select 1 from public.site_pages where id=current_page and church_id=p_church_id) then raise exception 'Section unavailable'; end if;
    -- Reject a stale read plan instead of moving a row after another admin changed layout.
    if current_page<>(item->>'sourcePageId')::uuid then raise exception 'Layout changed. Reload the page'; end if;
    target_path:=item->>'path';
    if target_path not in ('/','/about','/vision','/staff','/programs','/visit','/sermons','/give','/events') then raise exception 'Invalid page'; end if;
    insert into public.site_pages(church_id,path,title,status) values(p_church_id,target_path,item->>'title',home_status) on conflict(church_id,path) do nothing;
    select id into destination from public.site_pages where church_id=p_church_id and path=target_path;
    if item ? 'patch' then
      perform public.save_site_section_patch(p_church_id,(item->>'id')::uuid,item->'patch');
    end if;
    update public.site_sections set page_id=destination,sort_order=(item->>'sortOrder')::integer,
      landing_sort_order=(item->>'landingSortOrder')::integer,props=item->'props'
      where id=(item->>'id')::uuid and church_id=p_church_id;
  end loop;
  insert into public.site_settings(church_id,layout_mode) values(p_church_id,p_mode)
    on conflict(church_id) do update set layout_mode=excluded.layout_mode;
end $$;

-- Website facts use the existing shared profile tables, updating only the
-- visible website fields. Unrelated profile/assistant data is never replaced.
-- New rows have a stable UUID generated by the form, making retries idempotent.
create or replace function public.save_site_details(p_church_id uuid, p_details jsonb)
returns void language plpgsql security invoker set search_path = public as $$
declare item jsonb; row_id uuid; position integer; kept uuid[]; old_email text;
begin
  select email into old_email from public.churches where id=p_church_id for update;
  if not found then raise exception 'Church unavailable'; end if;
  -- Older generation copied the profile email into settings, freezing delivery
  -- to the old address. Convert that inherited value back to the profile
  -- fallback. A genuinely separate contact recipient remains untouched.
  update public.site_settings set contact_email=null where church_id=p_church_id and contact_email=old_email;
  update public.churches set name=p_details->>'name',denomination=nullif(p_details->>'denomination',''),
    logo_url=nullif(p_details->>'logoUrl',''),cover_image_url=nullif(p_details->>'coverImageUrl',''),
    address=nullif(p_details->>'address',''),city=nullif(p_details->>'city',''),state=nullif(p_details->>'state',''),zip=nullif(p_details->>'zip',''),
    phone=nullif(p_details->>'phone',''),email=nullif(p_details->>'email',''),google_maps_url=nullif(p_details->>'googleMapsUrl',''),
    mission_statement=nullif(p_details->>'missionStatement',''),vision_statement=nullif(p_details->>'visionStatement','') where id=p_church_id;
  update public.church_settings set denomination=nullif(p_details->>'denomination','') where church_id=p_church_id;
  update public.voice_assistant_settings set church_phone=nullif(p_details->>'phone',''),denomination=nullif(p_details->>'denomination','') where church_id=p_church_id;
  kept:='{}'; position:=0;
  for item in select * from jsonb_array_elements(p_details->'serviceTimes') loop
    row_id:=(item->>'id')::uuid;
    if row_id=any(kept) or exists(select 1 from public.church_service_times where id=row_id and church_id<>p_church_id) then raise exception 'Invalid service'; end if;
    insert into public.church_service_times(id,church_id,label,day_of_week,start_time,sort_order)
      values(row_id,p_church_id,item->>'label',(item->>'dayOfWeek')::smallint,(item->>'startTime')::time,position)
      on conflict(id) do update set label=excluded.label,day_of_week=excluded.day_of_week,start_time=excluded.start_time,sort_order=excluded.sort_order,updated_at=now();
    kept:=array_append(kept,row_id); position:=position+1;
  end loop;
  delete from public.church_service_times where church_id=p_church_id and not(id=any(kept));
  kept:='{}'; position:=0;
  for item in select * from jsonb_array_elements(p_details->'staff') loop
    row_id:=(item->>'id')::uuid;
    if row_id=any(kept) or exists(select 1 from public.church_staff where id=row_id and church_id<>p_church_id) then raise exception 'Invalid person'; end if;
    insert into public.church_staff(id,church_id,full_name,title,bio,photo_url,is_public,sort_order)
      values(row_id,p_church_id,item->>'fullName',nullif(item->>'title',''),nullif(item->>'bio',''),nullif(item->>'photoUrl',''),(item->>'isPublic')::boolean,position)
      on conflict(id) do update set full_name=excluded.full_name,title=excluded.title,bio=excluded.bio,photo_url=excluded.photo_url,is_public=excluded.is_public,sort_order=excluded.sort_order,updated_at=now();
    kept:=array_append(kept,row_id); position:=position+1;
  end loop;
  delete from public.church_staff where church_id=p_church_id and not(id=any(kept));
end $$;

revoke all on function public.create_site_draft(uuid,text,jsonb,text) from public,anon,authenticated;
revoke all on function public.set_site_publication(uuid,boolean) from public,anon,authenticated;
revoke all on function public.reorder_site_sections(uuid,uuid[]) from public,anon,authenticated;
revoke all on function public.save_site_section_patch(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.apply_site_layout(uuid,text,jsonb) from public,anon,authenticated;
revoke all on function public.save_site_details(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.create_site_draft(uuid,text,jsonb,text) to service_role;
grant execute on function public.set_site_publication(uuid,boolean) to service_role;
grant execute on function public.reorder_site_sections(uuid,uuid[]) to service_role;
grant execute on function public.save_site_section_patch(uuid,uuid,jsonb) to service_role;
grant execute on function public.apply_site_layout(uuid,text,jsonb) to service_role;
grant execute on function public.save_site_details(uuid,jsonb) to service_role;

notify pgrst, 'reload schema';
