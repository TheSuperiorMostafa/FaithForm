-- Per-calendar-event attendance
-- Migration 0089
--
-- A calendar event can opt into attendance without becoming a recurring
-- service. It is represented by the same immutable occurrence authority used
-- by automatic, QR, kiosk and staff check-in, so every method counts toward
-- one roster and one report.

alter table public.service_occurrences
  add column if not exists calendar_event_id text,
  add column if not exists calendar_id text,
  add column if not exists calendar_source text;

alter table public.service_occurrences
  drop constraint if exists service_occurrences_calendar_identity_complete;

alter table public.service_occurrences
  add constraint service_occurrences_calendar_identity_complete
  check (
    (calendar_event_id is null and calendar_id is null and calendar_source is null)
    or
    (calendar_event_id is not null and calendar_id is not null
      and calendar_source in ('google', 'apple'))
  );

create unique index if not exists service_occurrences_calendar_event_idx
  on public.service_occurrences (
    church_id, calendar_source, calendar_id, calendar_event_id
  );

-- Event identity, rather than label/place/time, owns event occurrences. Keep
-- the older identity for genuinely hand-created special services.
drop index if exists public.service_occurrences_manual_idx;
create unique index service_occurrences_manual_idx
  on public.service_occurrences (
    church_id,
    coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid),
    starts_at_utc,
    label
  )
  where service_time_id is null
    and generation_source <> 'schedule'
    and calendar_event_id is null;

create table if not exists public.event_attendance_setup_events (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  calendar_event_id text not null,
  actor_user_id uuid references auth.users (id) on delete set null,
  action text not null check (action in ('enabled', 'updated', 'disabled')),
  previous jsonb,
  next jsonb,
  created_at timestamptz not null default now()
);

create index if not exists event_attendance_setup_events_church_created_idx
  on public.event_attendance_setup_events (church_id, created_at desc);

alter table public.event_attendance_setup_events enable row level security;
revoke all on table public.event_attendance_setup_events
  from public, anon, authenticated;
grant all on table public.event_attendance_setup_events to service_role;
