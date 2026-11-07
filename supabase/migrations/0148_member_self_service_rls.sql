-- Member self-service RLS policies for volunteer scheduling

-- Allow members to update their own availability (added in 0145)
-- Security review: verify church relationship and same-church membership
create policy "group_memberships_update_own_availability"
  on public.group_memberships
  for update
  to authenticated
  using (
    -- Member owns this membership through their visitor account
    -- AND has active relationship with the church
    -- AND membership is for same church as the active relationship
    exists (
      select 1 
      from public.visitor_accounts va
      join public.visitor_church_relationships vcr 
        on vcr.account_id = va.id
        and vcr.status = 'active'
        and vcr.church_id = group_memberships.church_id
      where va.id = group_memberships.account_id
      and va.user_id = auth.uid()
    )
  )
  with check (
    -- Same ownership and church verification for updates
    exists (
      select 1 
      from public.visitor_accounts va
      join public.visitor_church_relationships vcr 
        on vcr.account_id = va.id
        and vcr.status = 'active'
        and vcr.church_id = group_memberships.church_id
      where va.id = group_memberships.account_id
      and va.user_id = auth.uid()
    )
  );

-- Grant update permission on availability column to authenticated users
grant update (availability) on table public.group_memberships to authenticated;

notify pgrst, 'reload schema';
