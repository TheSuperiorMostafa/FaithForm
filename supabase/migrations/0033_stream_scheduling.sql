-- Scheduled live stream events (Subsplash-style scheduling)

create table public.stream_events (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  title text not null,
  starts_at timestamptz not null,
  recurrence_rule text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'live', 'ended', 'cancelled')),
  syndicate_youtube boolean not null default true,
  syndicate_facebook boolean not null default true,
  youtube_privacy text not null default 'public'
    check (youtube_privacy in ('public', 'unlisted', 'private')),
  artwork_url text,
  chat_enabled boolean not null default false,
  countdown_enabled boolean not null default true,
  simulated boolean not null default false,
  simulated_source_path text,
  stream_session_id uuid references public.stream_sessions (id) on delete set null,
  syndication_retry_until timestamptz,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index stream_events_church_starts_idx
  on public.stream_events (church_id, starts_at desc);

create index stream_events_church_status_idx
  on public.stream_events (church_id, status);

alter table public.stream_sessions
  add column if not exists stream_event_id uuid
    references public.stream_events (id) on delete set null;

create table public.stream_syndication_attempts (
  id uuid primary key default gen_random_uuid(),
  stream_event_id uuid not null references public.stream_events (id) on delete cascade,
  platform text not null check (platform in ('youtube', 'facebook')),
  status text not null default 'pending'
    check (status in ('pending', 'success', 'failed')),
  error_message text,
  attempted_at timestamptz not null default now()
);

create index stream_syndication_event_idx
  on public.stream_syndication_attempts (stream_event_id, attempted_at desc);

drop trigger if exists stream_events_updated_at on public.stream_events;
create trigger stream_events_updated_at
  before update on public.stream_events
  for each row execute function public.set_stream_tables_updated_at();

alter table public.stream_events enable row level security;
alter table public.stream_syndication_attempts enable row level security;

create policy "stream_events_select"
  on public.stream_events
  for select
  to authenticated
  using (church_id in (select public.user_church_ids()));

create policy "stream_events_insert"
  on public.stream_events
  for insert
  to authenticated
  with check (public.is_church_admin(church_id));

create policy "stream_events_update"
  on public.stream_events
  for update
  to authenticated
  using (public.is_church_admin(church_id))
  with check (public.is_church_admin(church_id));

create policy "stream_events_delete"
  on public.stream_events
  for delete
  to authenticated
  using (public.is_church_admin(church_id));

create policy "stream_syndication_select"
  on public.stream_syndication_attempts
  for select
  to authenticated
  using (
    stream_event_id in (
      select id from public.stream_events
      where church_id in (select public.user_church_ids())
        and public.is_church_admin(church_id)
    )
  );
