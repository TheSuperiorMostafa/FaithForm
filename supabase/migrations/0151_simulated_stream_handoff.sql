-- Simulated playout is a resumable handoff for an existing broadcast.
-- Keep event artwork independent from the signed video URL and retain an
-- acknowledgement so a completed handoff is not recreated by the next poll.
create unique index if not exists stream_events_id_church_idx
  on public.stream_events(id, church_id);

create table if not exists public.stream_simulated_playout_handoffs (
  event_id uuid primary key references public.stream_events(id) on delete cascade,
  church_id uuid not null references public.churches(id) on delete cascade,
  source_url text,
  prepared_at timestamptz,
  completed_at timestamptz,
  foreign key (event_id, church_id) references public.stream_events(id, church_id) on delete cascade
);

-- Signed video URLs are relay credentials, never staff/browser-readable data.
alter table public.stream_simulated_playout_handoffs enable row level security;
revoke all on public.stream_simulated_playout_handoffs from public, anon, authenticated;
grant select, insert, update, delete on public.stream_simulated_playout_handoffs to service_role;

create index if not exists stream_simulated_playout_pending_idx
  on public.stream_simulated_playout_handoffs(event_id)
  where completed_at is null;

-- The previous schema stored pending video URLs on stream_events. Preserve
-- pending jobs and avoid relaunching an already-ingesting simulated broadcast.
insert into public.stream_simulated_playout_handoffs
  (event_id, church_id, source_url, prepared_at, completed_at)
select event.id, event.church_id, event.simulated_playout_url,
  case when event.simulated_playout_url is not null then now() end,
  case when event.simulated_playout_url is null then session.ingest_started_at end
from public.stream_events event
left join public.stream_sessions session
  on session.id = event.stream_session_id and session.church_id = event.church_id
where event.simulated and event.status = 'live'
  and (event.simulated_playout_url is not null or session.ingest_started_at is not null)
on conflict (event_id) do nothing;
