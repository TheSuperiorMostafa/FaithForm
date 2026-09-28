-- A browser retry or two simultaneous submissions of Add church must resolve
-- to one workspace. Null keeps existing and self-serve church creation intact.
alter table public.churches
  add column if not exists admin_create_request_id uuid;

create unique index if not exists churches_admin_create_request_idx
  on public.churches (admin_create_request_id)
  where admin_create_request_id is not null;

notify pgrst, 'reload schema';
