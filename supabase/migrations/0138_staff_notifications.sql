create table public.staff_notification_preferences (
  church_id uuid not null references public.churches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null default '',
  events jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key(church_id, user_id)
);
alter table public.staff_notification_preferences enable row level security;
revoke all on public.staff_notification_preferences from public, anon, authenticated;
grant select on public.staff_notification_preferences to authenticated;
grant all on public.staff_notification_preferences to service_role;
create policy staff_notification_preferences_select on public.staff_notification_preferences
  for select to authenticated using (user_id = auth.uid() and church_id in (select public.user_church_ids()));

create table public.staff_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null check(event in ('attendance_documents','attendance_completed','kids_alerts')),
  event_key text not null,
  channel text not null check(channel in ('email','phone')),
  href text not null,
  status text not null default 'queued' check(status in ('queued','sending','sent','failed','skipped')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(church_id, user_id, event, event_key, channel)
);
alter table public.staff_notification_jobs enable row level security;
revoke all on public.staff_notification_jobs from public, anon, authenticated;
grant all on public.staff_notification_jobs to service_role;
create index staff_notification_jobs_pending on public.staff_notification_jobs(created_at) where status in ('queued','sending');

create function public.claim_staff_notification_jobs(p_limit integer default 10)
returns setof public.staff_notification_jobs
language sql security invoker set search_path = public as $$
  update staff_notification_jobs set status = 'sending', updated_at = now(), attempts = attempts + 1
  where id in (
    select id from staff_notification_jobs
    where (status = 'queued' or (status = 'sending' and channel = 'email' and updated_at < now() - interval '5 minutes'))
      and attempts < 3
    order by created_at for update skip locked limit least(greatest(p_limit, 1), 50)
  ) returning *;
$$;
revoke all on function public.claim_staff_notification_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_staff_notification_jobs(integer) to service_role;
