-- Live stream recordings and VOD

create table public.stream_recordings (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  stream_session_id uuid references public.stream_sessions (id) on delete set null,
  stream_event_id uuid references public.stream_events (id) on delete set null,
  title text,
  storage_path text not null,
  duration_sec numeric,
  status text not null default 'processing'
    check (status in ('processing', 'ready', 'published')),
  trim_start_sec numeric not null default 0,
  trim_end_sec numeric,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stream_recordings_church_idx
  on public.stream_recordings (church_id, created_at desc);

drop trigger if exists stream_recordings_updated_at on public.stream_recordings;
create trigger stream_recordings_updated_at
  before update on public.stream_recordings
  for each row execute function public.set_stream_tables_updated_at();

alter table public.stream_recordings enable row level security;

create policy "stream_recordings_select"
  on public.stream_recordings
  for select
  to authenticated
  using (church_id in (select public.user_church_ids()));

create policy "stream_recordings_insert"
  on public.stream_recordings
  for insert
  to authenticated
  with check (public.is_church_admin(church_id));

create policy "stream_recordings_update"
  on public.stream_recordings
  for update
  to authenticated
  using (public.is_church_admin(church_id))
  with check (public.is_church_admin(church_id));

create policy "stream_recordings_delete"
  on public.stream_recordings
  for delete
  to authenticated
  using (public.is_church_admin(church_id));
