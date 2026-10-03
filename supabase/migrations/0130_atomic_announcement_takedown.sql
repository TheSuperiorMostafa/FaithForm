-- Rewind the announcement and remove explicit weekly-email membership together.
-- Only verified server actions may call this; ordinary browser roles gain no
-- mutation capability. The supplied actor must still administer this church.
create or replace function public.take_down_announcement(
  p_church_id uuid,
  p_announcement_id uuid,
  p_actor_user_id uuid,
  p_facebook_still_live boolean default false
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_event_id text;
begin
  if p_actor_user_id is null or not (
    exists (select 1 from public.church_users
      where church_id = p_church_id and user_id = p_actor_user_id and role = 'admin')
    or exists (select 1 from public.platform_admins where user_id = p_actor_user_id)
  ) then
    raise exception 'Announcement takedown forbidden' using errcode = '42501';
  end if;

  select google_event_id into v_event_id from public.announcements
   where id = p_announcement_id and church_id = p_church_id
   for update;
  if not found then return false; end if;

  update public.announcements
     set status = 'pending', is_ready = false,
         push_to_team = false, push_to_facebook = false,
         published_at = null, last_publish_error = null,
         facebook_post_id = case when p_facebook_still_live then facebook_post_id else null end,
         facebook_scheduled_publish_time = null,
         unsubmitted_at = now(), unsubmitted_by = p_actor_user_id
   where id = p_announcement_id and church_id = p_church_id;

  if v_event_id is not null then
    delete from public.announcement_email_queue
     where church_id = p_church_id and google_event_id = v_event_id;
  end if;
  return true;
end;
$$;

revoke all on function public.take_down_announcement(uuid, uuid, uuid, boolean)
  from public, anon, authenticated;
grant execute on function public.take_down_announcement(uuid, uuid, uuid, boolean)
  to service_role;
