create table support_tickets (
  id uuid primary key default gen_random_uuid(),
  church_id uuid references churches(id) on delete set null,
  submitted_by uuid references auth.users(id) on delete set null,
  subject text not null,
  body text,
  status text check (status in ('open', 'in_progress', 'resolved')) default 'open',
  priority text check (priority in ('low', 'normal', 'high', 'urgent')) default 'normal',
  admin_notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table support_tickets enable row level security;

-- Church users can see their own church tickets
create policy "church_can_view_own_tickets" on support_tickets
  for select using (church_id = any(user_church_ids()));
