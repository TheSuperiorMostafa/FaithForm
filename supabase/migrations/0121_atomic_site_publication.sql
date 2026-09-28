-- Publishing and unpublishing must change the page and site settings in one
-- transaction. A failed second write must never leave a site publicly visible
-- after the editor reported that publishing failed.
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
  select id into v_home_id
    from public.site_pages
   where church_id = p_church_id and path = '/'
   for update;
  if not found then
    return 'no_page';
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
