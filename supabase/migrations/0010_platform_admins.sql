-- Super admin access table
create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz default now()
);

-- Only superadmins can read this table (checked server-side via admin client)
alter table platform_admins enable row level security;
create policy "platform_admins_select" on platform_admins
  for select using (auth.uid() = user_id);
