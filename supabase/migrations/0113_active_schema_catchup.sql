-- A comparison with the 2026-09-27 production archive found partially applied
-- older migrations. Add only the missing objects used by current application
-- paths; do not replay old data-changing migrations against live churches.

-- Dashboard query shapes become expensive as tenants and gifts accumulate.
create index if not exists church_users_user_created_idx
  on public.church_users (user_id, created_at);
create index if not exists members_church_active_name_idx
  on public.members (church_id, is_active, last_name, first_name);
create index if not exists giving_donations_church_status_created_idx
  on public.giving_donations (church_id, status, created_at desc);

-- Existing follow-up and scheduled-Facebook code reads these fields.
alter table public.attendance_entries
  add column if not exists follow_up_sent_at timestamptz,
  add column if not exists follow_up_error text;
alter table public.announcements
  add column if not exists facebook_scheduled_publish_time timestamptz;

-- Church app quick links and public discovery projections. Current callers use
-- the service role; browsers do not need direct execute on these functions.
alter table public.churches
  add column if not exists app_links jsonb not null default '[]'::jsonb;
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.churches'::regclass
      and conname = 'churches_app_links_is_array'
  ) then
    alter table public.churches add constraint churches_app_links_is_array
      check (jsonb_typeof(app_links) = 'array' and jsonb_array_length(app_links) <= 12);
  end if;
end $$;

create or replace function public.public_church_app_page(p_slug text)
returns table (
  description text, google_maps_url text, instagram_url text,
  facebook_url text, youtube_url text, tiktok_url text, x_url text,
  podcast_url text, app_links jsonb
)
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select c.description, c.google_maps_url, c.instagram_url, c.facebook_url,
         c.youtube_url, c.tiktok_url, c.x_url, c.podcast_url, c.app_links
    from public.churches c
   where c.is_discoverable and c.slug = p_slug;
$$;

create or replace function public.public_church_services(p_slug text)
returns table (label text, day_of_week smallint, start_time time, kind text)
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select st.label, st.day_of_week, st.start_time, st.kind
    from public.churches c
    join public.church_service_times st on st.church_id = c.id
   where c.is_discoverable and c.slug = p_slug and st.campus_id is null
   order by st.sort_order, st.id;
$$;
revoke all on function public.public_church_app_page(text) from public, anon, authenticated;
revoke all on function public.public_church_services(text) from public, anon, authenticated;
grant execute on function public.public_church_app_page(text) to service_role;
grant execute on function public.public_church_services(text) to service_role;

-- Group notifications use the existing outbox, but production lacked the
-- targeted-recipient column and its topic/shape constraints.
alter table public.notification_outbox
  add column if not exists target_account_ids uuid[];
alter table public.notification_outbox
  drop constraint if exists notification_outbox_kind_check;
alter table public.notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in (
    'announcement_published', 'event_published', 'service_live', 'recording_published',
    'group_join_requested', 'group_request_approved', 'group_event_cancelled', 'group_message'
  ));
alter table public.notification_outbox
  drop constraint if exists notification_outbox_subject_type_check;
alter table public.notification_outbox
  add constraint notification_outbox_subject_type_check
  check (subject_type in (
    'announcement', 'stream_event', 'stream_recording', 'group_join_request', 'group_event', 'group_message'
  ));
do $$
declare v_constraint text;
begin
  for v_constraint in
    select conname from pg_constraint
     where conrelid = 'public.notification_outbox'::regclass
       and contype = 'c' and pg_get_constraintdef(oid) ~ '\mtopic\M'
  loop
    execute format('alter table public.notification_outbox drop constraint %I', v_constraint);
  end loop;
end $$;
alter table public.notification_outbox
  add constraint notification_outbox_topic_check
  check (topic in ('announcements', 'events', 'groups'));
alter table public.notification_outbox
  drop constraint if exists notification_outbox_target_shape_check;
alter table public.notification_outbox
  add constraint notification_outbox_target_shape_check
  check (
    (topic = 'groups') = (target_account_ids is not null)
    and (target_account_ids is null or cardinality(target_account_ids) between 1 and 200)
  );

-- Website domain requests are a church-admin action and a platform work queue.
-- Existing site_domains routing rows remain intact.
alter table public.site_domains
  add column if not exists status text not null default 'pending_dns',
  add column if not exists dns_checked_at timestamptz,
  add column if not exists dns_detail text,
  add column if not exists provider text not null default 'manual',
  add column if not exists provider_domain_id text,
  add column if not exists requested_by uuid references auth.users (id) on delete set null,
  add column if not exists notes text,
  add column if not exists updated_at timestamptz not null default now();
do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.site_domains'::regclass
       and conname = 'site_domains_status_check'
  ) then
    alter table public.site_domains add constraint site_domains_status_check
      check (status in ('pending_dns', 'dns_ok', 'live', 'failed'));
  end if;
end $$;
update public.site_domains set status = 'live'
 where verified_at is not null and status = 'pending_dns';
drop trigger if exists site_domains_updated_at on public.site_domains;
create trigger site_domains_updated_at before update on public.site_domains
  for each row execute function public.set_site_tables_updated_at();

create table if not exists public.site_domain_requests (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  requested_by uuid references auth.users (id) on delete set null,
  kind text not null check (kind in ('connect_existing', 'register_new')),
  hostname text check (hostname is null or hostname = lower(hostname)),
  alternate_hostnames text[] not null default '{}',
  registrar text,
  contact_name text, contact_email text, contact_phone text, notes text,
  status text not null default 'submitted' check (status in (
    'submitted', 'in_review', 'awaiting_church', 'in_progress',
    'completed', 'declined', 'cancelled'
  )),
  admin_notes text,
  domain_id uuid references public.site_domains (id) on delete set null,
  handled_by uuid references auth.users (id) on delete set null,
  handled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint site_domain_requests_hostname_required check (
    kind <> 'connect_existing' or (hostname is not null and hostname <> '')
  )
);
create index if not exists site_domain_requests_church_id_idx
  on public.site_domain_requests (church_id, created_at desc);
create index if not exists site_domain_requests_open_idx
  on public.site_domain_requests (created_at)
  where status in ('submitted', 'in_review', 'awaiting_church', 'in_progress');
create unique index if not exists site_domain_requests_one_open_idx
  on public.site_domain_requests (church_id)
  where status in ('submitted', 'in_review', 'awaiting_church', 'in_progress');
drop trigger if exists site_domain_requests_updated_at on public.site_domain_requests;
create trigger site_domain_requests_updated_at before update on public.site_domain_requests
  for each row execute function public.set_site_tables_updated_at();
alter table public.site_domain_requests enable row level security;
drop policy if exists site_domain_requests_select on public.site_domain_requests;
create policy site_domain_requests_select on public.site_domain_requests
  for select to authenticated
  using (church_id in (select public.user_church_ids()));
revoke all on table public.site_domain_requests from public, anon, authenticated;
grant select on table public.site_domain_requests to authenticated;
grant all on table public.site_domain_requests to service_role;

notify pgrst, 'reload schema';
