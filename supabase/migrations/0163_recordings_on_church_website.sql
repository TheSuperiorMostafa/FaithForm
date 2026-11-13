-- An explicit website publication also makes its existing Sermons section
-- reachable. Delegate all recording eligibility/identity checks to the single
-- canonical publisher; never create a second publication authority.
create or replace function public.publish_recording_on_site(
  p_recording_id uuid, p_church_id uuid, p_app_visibility text,
  p_publish_to_web boolean, p_poster_url text, p_summary text,
  p_expected_revision integer, p_expected_object_hash text,
  p_actor_user_id uuid, p_via text default 'staff', p_now timestamptz default now()
)
returns table(ok boolean, reason text, changed boolean, previous_visibility text)
language plpgsql volatile security invoker set search_path=public as $$
declare outcome record; site record; nav record; section_changed boolean:=false;
begin
  perform 1 from public.churches where id=p_church_id for update;
  select * into outcome from public.publish_recording(
    p_recording_id,p_church_id,p_app_visibility,p_publish_to_web,p_poster_url,p_summary,
    p_expected_revision,p_expected_object_hash,p_actor_user_id,p_via,p_now
  );
  if outcome.ok and p_publish_to_web and p_via='staff' then
    select s.is_published,s.layout_mode into site from public.site_settings s where s.church_id=p_church_id;
    -- The church explicitly chose to show Sermons. Preserve every saved
    -- content/design/order value and enable only the existing feed rows.
    update public.site_sections s set is_visible=true
      where s.church_id=p_church_id and s.type='sermon_feed' and not s.is_visible;
    section_changed:=found;
    if site.is_published and exists(select 1 from public.site_pages p where p.church_id=p_church_id and p.path='/' and p.status='published') then
      update public.site_pages p set status='published'
        where p.church_id=p_church_id and p.path='/sermons' and p.status<>'published'
          and exists(select 1 from public.site_sections s where s.page_id=p.id and s.church_id=p_church_id and s.type='sermon_feed' and s.is_visible);
      section_changed:=section_changed or found;
    end if;
    -- Generated navigation omitted an empty feed at creation. Add its link
    -- when needed, while an authored links override keeps complete control.
    for nav in select s.id,s.page_id,s.props from public.site_sections s
      where s.church_id=p_church_id and s.type='site_nav'
    loop
      if coalesce(jsonb_typeof(nav.props->'links'),'null')='array'
        and not exists(select 1 from public.site_overrides o where o.church_id=p_church_id and (
          (o.scope='section' and o.section_id=nav.id and o.patch ? 'links')
          or (o.scope in ('church','page') and (o.scope='church' or o.page_id=nav.page_id) and (o.patch#>'{sections,site_nav}') ? 'links')
        ))
        and not exists(select 1 from jsonb_array_elements(nav.props->'links') link where link->>'href' in ('#sermons','/sermons'))
        and exists(select 1 from public.site_sections s where s.church_id=p_church_id and s.type='sermon_feed' and s.is_visible)
      then
        update public.site_sections set props=jsonb_set(props,'{links}',(props->'links') || jsonb_build_array(jsonb_build_object(
          'label','Sermons','href',case when site.layout_mode='website' then '/sermons' else '#sermons' end
        ))) where id=nav.id and church_id=p_church_id;
        section_changed:=true;
      end if;
    end loop;
  end if;
  return query select outcome.ok,
    case when section_changed and outcome.reason='unchanged' then 'ok' else outcome.reason end,
    outcome.changed or section_changed,outcome.previous_visibility;
end $$;

revoke all on function public.publish_recording_on_site(uuid,uuid,text,boolean,text,text,integer,text,uuid,text,timestamptz) from public,anon,authenticated;
grant execute on function public.publish_recording_on_site(uuid,uuid,text,boolean,text,text,integer,text,uuid,text,timestamptz) to service_role;

notify pgrst, 'reload schema';
