-- FaithForm: RLS helpers and policies
-- Migration 0002

-- ---------------------------------------------------------------------------
-- HELPERS
-- ---------------------------------------------------------------------------

create or replace function public.user_church_ids()
returns setof uuid
language sql
security definer
stable
set search_path = public
as $$
  select church_id from public.church_users where user_id = auth.uid()
$$;

create or replace function public.is_church_admin(target_church_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.church_users
    where user_id = auth.uid()
      and church_id = target_church_id
      and role = 'admin'
  )
$$;

-- ---------------------------------------------------------------------------
-- ENABLE RLS
-- ---------------------------------------------------------------------------

alter table public.churches enable row level security;
alter table public.church_users enable row level security;
alter table public.members enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_entries enable row level security;
alter table public.announcements enable row level security;
alter table public.activity_log enable row level security;
alter table public.phone_calls enable row level security;

-- ---------------------------------------------------------------------------
-- CHURCHES (read-only for authenticated; created via service role)
-- ---------------------------------------------------------------------------

create policy "churches_select"
  on public.churches
  for select
  to authenticated
  using (id in (select public.user_church_ids()));

-- ---------------------------------------------------------------------------
-- CHURCH_USERS
-- ---------------------------------------------------------------------------

create policy "church_users_select"
  on public.church_users
  for select
  to authenticated
  using (user_id = auth.uid() or public.is_church_admin(church_id));

create policy "church_users_insert"
  on public.church_users
  for insert
  to authenticated
  with check (public.is_church_admin(church_id));

create policy "church_users_update"
  on public.church_users
  for update
  to authenticated
  using (public.is_church_admin(church_id))
  with check (public.is_church_admin(church_id));

create policy "church_users_delete"
  on public.church_users
  for delete
  to authenticated
  using (public.is_church_admin(church_id));

-- ---------------------------------------------------------------------------
-- MEMBERS (admin-only writes)
-- ---------------------------------------------------------------------------

create policy "members_select"
  on public.members
  for select
  to authenticated
  using (church_id in (select public.user_church_ids()));

create policy "members_insert"
  on public.members
  for insert
  to authenticated
  with check (public.is_church_admin(church_id));

create policy "members_update"
  on public.members
  for update
  to authenticated
  using (public.is_church_admin(church_id))
  with check (public.is_church_admin(church_id));

create policy "members_delete"
  on public.members
  for delete
  to authenticated
  using (public.is_church_admin(church_id));

-- ---------------------------------------------------------------------------
-- ATTENDANCE_RECORDS (any church member can write)
-- ---------------------------------------------------------------------------

create policy "attendance_records_select"
  on public.attendance_records
  for select
  to authenticated
  using (church_id in (select public.user_church_ids()));

create policy "attendance_records_insert"
  on public.attendance_records
  for insert
  to authenticated
  with check (church_id in (select public.user_church_ids()));

create policy "attendance_records_update"
  on public.attendance_records
  for update
  to authenticated
  using (church_id in (select public.user_church_ids()))
  with check (church_id in (select public.user_church_ids()));

create policy "attendance_records_delete"
  on public.attendance_records
  for delete
  to authenticated
  using (church_id in (select public.user_church_ids()));

-- ---------------------------------------------------------------------------
-- ATTENDANCE_ENTRIES (any church member can write)
-- ---------------------------------------------------------------------------

create policy "attendance_entries_select"
  on public.attendance_entries
  for select
  to authenticated
  using (church_id in (select public.user_church_ids()));

create policy "attendance_entries_insert"
  on public.attendance_entries
  for insert
  to authenticated
  with check (church_id in (select public.user_church_ids()));

create policy "attendance_entries_update"
  on public.attendance_entries
  for update
  to authenticated
  using (church_id in (select public.user_church_ids()))
  with check (church_id in (select public.user_church_ids()));

create policy "attendance_entries_delete"
  on public.attendance_entries
  for delete
  to authenticated
  using (church_id in (select public.user_church_ids()));

-- ---------------------------------------------------------------------------
-- ANNOUNCEMENTS (admin-only writes)
-- ---------------------------------------------------------------------------

create policy "announcements_select"
  on public.announcements
  for select
  to authenticated
  using (church_id in (select public.user_church_ids()));

create policy "announcements_insert"
  on public.announcements
  for insert
  to authenticated
  with check (public.is_church_admin(church_id));

create policy "announcements_update"
  on public.announcements
  for update
  to authenticated
  using (public.is_church_admin(church_id))
  with check (public.is_church_admin(church_id));

create policy "announcements_delete"
  on public.announcements
  for delete
  to authenticated
  using (public.is_church_admin(church_id));

-- ---------------------------------------------------------------------------
-- ACTIVITY_LOG (admin-only writes)
-- ---------------------------------------------------------------------------

create policy "activity_log_select"
  on public.activity_log
  for select
  to authenticated
  using (church_id in (select public.user_church_ids()));

create policy "activity_log_insert"
  on public.activity_log
  for insert
  to authenticated
  with check (public.is_church_admin(church_id));

create policy "activity_log_update"
  on public.activity_log
  for update
  to authenticated
  using (public.is_church_admin(church_id))
  with check (public.is_church_admin(church_id));

create policy "activity_log_delete"
  on public.activity_log
  for delete
  to authenticated
  using (public.is_church_admin(church_id));

-- ---------------------------------------------------------------------------
-- PHONE_CALLS (admin-only writes)
-- ---------------------------------------------------------------------------

create policy "phone_calls_select"
  on public.phone_calls
  for select
  to authenticated
  using (church_id in (select public.user_church_ids()));

create policy "phone_calls_insert"
  on public.phone_calls
  for insert
  to authenticated
  with check (public.is_church_admin(church_id));

create policy "phone_calls_update"
  on public.phone_calls
  for update
  to authenticated
  using (public.is_church_admin(church_id))
  with check (public.is_church_admin(church_id));

create policy "phone_calls_delete"
  on public.phone_calls
  for delete
  to authenticated
  using (public.is_church_admin(church_id));
