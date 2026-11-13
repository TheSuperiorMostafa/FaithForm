-- Fix forward after 0161: keep the existing text refusal contract and refuse
-- an incomplete first draft without changing publication state.
create or replace function public.set_site_publication(
  p_church_id uuid,
  p_published boolean
)
returns text
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_home_id uuid;
begin
  -- Serialize with draft creation and layout changes for the same church.
  perform 1 from public.churches where id = p_church_id for update;
  select id into v_home_id
    from public.site_pages
   where church_id = p_church_id and path = '/'
   for update;
  if not found then
    return 'no_page';
  end if;
  if p_published and not exists (
    select 1 from public.site_sections
     where church_id = p_church_id and page_id = v_home_id
  ) then
    return 'no_sections';
  end if;

  update public.site_pages
     set status = case when p_published then 'published' else 'draft' end
   where church_id = p_church_id;
  insert into public.site_settings (church_id, is_published)
  values (p_church_id, p_published)
  on conflict (church_id) do update
    set is_published = excluded.is_published;

  return case when p_published then 'published' else 'unpublished' end;
end;
$$;

revoke all on function public.set_site_publication(uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.set_site_publication(uuid, boolean)
  to service_role;

notify pgrst, 'reload schema';
