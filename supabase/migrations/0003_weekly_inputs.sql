create table if not exists public.weekly_inputs (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  week_start date not null,
  follow_ups int not null default 0 check (follow_ups >= 0),
  phone_calls int not null default 0 check (phone_calls >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (church_id, week_start)
);

create table if not exists public.attendance (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  service_date date not null,
  count int not null default 0 check (count >= 0),
  created_at timestamptz not null default now(),
  unique (church_id, service_date)
);

create table if not exists public.church_metrics (
  church_id uuid primary key references public.churches (id) on delete cascade,
  hours_saved_month numeric(10, 2) not null default 0,
  updated_at timestamptz not null default now()
);

alter table public.weekly_inputs enable row level security;
alter table public.attendance enable row level security;
alter table public.church_metrics enable row level security;

create policy "Church members can read weekly inputs"
  on public.weekly_inputs for select
  using (church_id in (select public.user_church_ids()));

create policy "Editors can upsert weekly inputs"
  on public.weekly_inputs for all
  using (church_id in (select public.user_church_ids()))
  with check (church_id in (select public.user_church_ids()));

create policy "Church members can read attendance"
  on public.attendance for select
  using (church_id in (select public.user_church_ids()));

create policy "Editors can manage attendance"
  on public.attendance for all
  using (church_id in (select public.user_church_ids()))
  with check (church_id in (select public.user_church_ids()));

create policy "Church members can read metrics"
  on public.church_metrics for select
  using (church_id in (select public.user_church_ids()));
