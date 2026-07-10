-- Production live streaming: sessions, encoder pairing, remote commands

create table public.encoder_devices (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  label text not null default 'Streaming PC',
  encoder_type text not null default 'obs'
    check (encoder_type in ('obs', 'atem', 'other')),
  device_secret_hash text,
  pairing_code_hash text,
  pairing_expires_at timestamptz,
  obs_websocket_host text not null default '127.0.0.1',
  obs_websocket_port int not null default 4455,
  obs_websocket_password text,
  last_seen_at timestamptz,
  paired_at timestamptz,
  paired_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index encoder_devices_church_id_idx
  on public.encoder_devices (church_id);

create table public.stream_sessions (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  status text not null
    check (status in ('preparing', 'waiting_for_encoder', 'live', 'ended', 'error')),
  title text,
  started_by uuid references auth.users (id) on delete set null,
  encoder_device_id uuid references public.encoder_devices (id) on delete set null,
  destinations_snapshot jsonb not null default '[]'::jsonb,
  error_message text,
  ingest_started_at timestamptz,
  live_started_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index stream_sessions_one_active_idx
  on public.stream_sessions (church_id)
  where status in ('preparing', 'waiting_for_encoder', 'live');

create index stream_sessions_church_created_idx
  on public.stream_sessions (church_id, created_at desc);

create table public.stream_commands (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  encoder_device_id uuid not null references public.encoder_devices (id) on delete cascade,
  command text not null check (command in ('start_stream', 'stop_stream')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'completed', 'failed')),
  error_message text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index stream_commands_device_pending_idx
  on public.stream_commands (encoder_device_id, created_at)
  where status = 'pending';

create or replace function public.set_stream_tables_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists encoder_devices_updated_at on public.encoder_devices;
create trigger encoder_devices_updated_at
  before update on public.encoder_devices
  for each row execute function public.set_stream_tables_updated_at();

drop trigger if exists stream_sessions_updated_at on public.stream_sessions;
create trigger stream_sessions_updated_at
  before update on public.stream_sessions
  for each row execute function public.set_stream_tables_updated_at();

alter table public.encoder_devices enable row level security;
alter table public.stream_sessions enable row level security;
alter table public.stream_commands enable row level security;

create policy "encoder_devices_select"
  on public.encoder_devices
  for select
  to authenticated
  using (
    church_id in (select public.user_church_ids())
    and public.is_church_admin(church_id)
  );

create policy "encoder_devices_insert"
  on public.encoder_devices
  for insert
  to authenticated
  with check (public.is_church_admin(church_id));

create policy "encoder_devices_update"
  on public.encoder_devices
  for update
  to authenticated
  using (public.is_church_admin(church_id))
  with check (public.is_church_admin(church_id));

create policy "encoder_devices_delete"
  on public.encoder_devices
  for delete
  to authenticated
  using (public.is_church_admin(church_id));

create policy "stream_sessions_select"
  on public.stream_sessions
  for select
  to authenticated
  using (church_id in (select public.user_church_ids()));

create policy "stream_sessions_insert"
  on public.stream_sessions
  for insert
  to authenticated
  with check (public.is_church_admin(church_id));

create policy "stream_sessions_update"
  on public.stream_sessions
  for update
  to authenticated
  using (public.is_church_admin(church_id))
  with check (public.is_church_admin(church_id));

create policy "stream_commands_select"
  on public.stream_commands
  for select
  to authenticated
  using (
    church_id in (select public.user_church_ids())
    and public.is_church_admin(church_id)
  );
