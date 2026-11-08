-- Private state for the relay's encoder-driven broadcast lifecycle.
create table public.stream_encoder_automation (
  church_id uuid primary key references public.churches (id) on delete cascade,
  enabled boolean not null default false,
  authorized_source_id uuid,
  authorized_at timestamptz,
  source_id uuid,
  source_stopped boolean not null default false,
  session_id uuid references public.stream_sessions (id) on delete set null,
  stop_after timestamptz,
  operation_id uuid,
  operation_expires_at timestamptz
);

alter table public.stream_encoder_automation enable row level security;
revoke all on public.stream_encoder_automation from public, anon, authenticated;
grant select, insert, update on public.stream_encoder_automation to service_role;

create index stream_encoder_automation_stop_due_idx
  on public.stream_encoder_automation (stop_after)
  where session_id is not null and stop_after is not null;
