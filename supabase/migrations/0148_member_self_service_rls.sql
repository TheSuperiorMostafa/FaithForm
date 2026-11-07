-- Member self-service RLS policies for volunteer scheduling

-- Allow members to update their own availability (added in 0145)
create policy "group_memberships_update_own_availability"
  on public.group_memberships
  for update
  to authenticated
  using (
    -- Member owns this membership through their visitor account
    exists (
      select 1 from public.visitor_accounts
      where id = group_memberships.account_id
      and user_id = auth.uid()
    )
  )
  with check (
    -- Can only update availability column, not other fields
    exists (
      select 1 from public.visitor_accounts
      where id = group_memberships.account_id
      and user_id = auth.uid()
    )
  );

-- Grant update permission on availability column to authenticated users
grant update (availability) on table public.group_memberships to authenticated;

notify pgrst, 'reload schema';
