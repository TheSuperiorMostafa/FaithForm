-- FaithForm seed data
-- Run after migrations. Idempotent via ON CONFLICT DO NOTHING.
--
-- After signing up in Supabase Auth, link your user to the seed church:
--
-- insert into public.church_users (church_id, user_id, role)
-- values ('11111111-1111-1111-1111-111111111111', '<your-auth-user-uuid>', 'admin');

insert into public.churches (id, name, timezone)
values (
  '11111111-1111-1111-1111-111111111111',
  'Grace Community Church',
  'America/New_York'
)
on conflict (id) do nothing;

insert into public.members (id, church_id, first_name, last_name, phone, email)
values
  (
    '22222222-2222-2222-2222-222222222221',
    '11111111-1111-1111-1111-111111111111',
    'Sarah',
    'Johnson',
    '+15551110001',
    'sarah@example.com'
  ),
  (
    '22222222-2222-2222-2222-222222222222',
    '11111111-1111-1111-1111-111111111111',
    'David',
    'Martinez',
    '+15551110002',
    'david@example.com'
  ),
  (
    '22222222-2222-2222-2222-222222222223',
    '11111111-1111-1111-1111-111111111111',
    'Emily',
    'Nguyen',
    '+15551110003',
    'emily@example.com'
  ),
  (
    '22222222-2222-2222-2222-222222222224',
    '11111111-1111-1111-1111-111111111111',
    'Marcus',
    'Brown',
    '+15551110004',
    'marcus@example.com'
  ),
  (
    '22222222-2222-2222-2222-222222222225',
    '11111111-1111-1111-1111-111111111111',
    'Olivia',
    'Patel',
    '+15551110005',
    'olivia@example.com'
  )
on conflict (id) do nothing;
