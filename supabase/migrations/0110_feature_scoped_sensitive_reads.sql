-- Limit direct PostgREST reads to the staff features that own the data.
-- The dashboard has its own feature gates, but a signed-in staff member can
-- also call PostgREST with their session token. Those reads need the same
-- boundary at the database. Service-role reads used by public donor and
-- check-in flows are unaffected by these authenticated policies.

drop policy if exists "giving_donations_select" on public.giving_donations;
create policy "giving_donations_select" on public.giving_donations
  for select to authenticated
  using (public.user_has_feature(church_id, 'giving'));

drop policy if exists "giving_subscriptions_select" on public.giving_subscriptions;
create policy "giving_subscriptions_select" on public.giving_subscriptions
  for select to authenticated
  using (public.user_has_feature(church_id, 'giving'));

drop policy if exists "giving_donors_select" on public.giving_donors;
create policy "giving_donors_select" on public.giving_donors
  for select to authenticated
  using (public.user_has_feature(church_id, 'giving'));

drop policy if exists "phone_calls_select" on public.phone_calls;
create policy "phone_calls_select" on public.phone_calls
  for select to authenticated
  using (public.user_has_feature(church_id, 'voice_assistant'));

drop policy if exists "members_select" on public.members;
create policy "members_select" on public.members
  for select to authenticated
  using (
    public.user_has_feature(church_id, 'people')
    or public.user_has_feature(church_id, 'attendance')
    or public.user_has_feature(church_id, 'attendance_follow_up')
    or public.user_has_feature(church_id, 'checkin')
  );

-- A row policy cannot hide one column. Attendance staff need names for the
-- Sunday roster but have no reason to fetch medical notes directly with their
-- Supabase token. Server reads for People and Kids Check-in are feature-checked
-- before using the service role for this one field.
revoke select on table public.members from public, anon, authenticated;
grant select (
  id, church_id, first_name, last_name, phone, email, photo_url, is_active,
  created_at, default_location_id, source
) on table public.members to authenticated;

drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select to authenticated
  using (
    public.user_has_feature(church_id, 'people')
    or public.user_has_feature(church_id, 'checkin')
  );

drop policy if exists household_members_select on public.household_members;
create policy household_members_select on public.household_members
  for select to authenticated
  using (
    public.user_has_feature(church_id, 'people')
    or public.user_has_feature(church_id, 'checkin')
  );

drop policy if exists household_pickup_select on public.household_pickup_authorizations;
create policy household_pickup_select on public.household_pickup_authorizations
  for select to authenticated
  using (
    public.user_has_feature(church_id, 'people')
    or public.user_has_feature(church_id, 'checkin')
  );

drop policy if exists checkin_sessions_select on public.checkin_sessions;
create policy checkin_sessions_select on public.checkin_sessions
  for select to authenticated
  using (
    public.user_has_feature(church_id, 'people')
    or public.user_has_feature(church_id, 'checkin')
  );

drop policy if exists member_files_select on public.member_files;
create policy member_files_select on public.member_files
  for select to authenticated
  using (
    public.user_has_feature(church_id, 'people')
    and (visibility = 'staff' or public.is_church_admin(church_id))
  );
