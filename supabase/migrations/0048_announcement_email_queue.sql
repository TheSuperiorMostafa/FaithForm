-- What goes in this week's announcement email
-- Migration 0048
--
-- The Gmail draft used to be "whatever is on the calendar between this Monday
-- and Sunday". That is not what a church wants: they want to *put* an event in
-- the email, including one that is a fortnight out and needs telling people
-- about now.
--
-- So the email gets an explicit queue. An event is in the email because someone
-- added it, not because of when it happens.
--
-- The reset is the week_start key rather than a delete: come Monday midnight in
-- the church's own timezone, the key moves on and last week's rows stop
-- matching. The queue empties itself, and what was sent stays on the record.

create table if not exists public.announcement_email_queue (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,

  -- The church-local Monday this queue belongs to.
  week_start date not null,

  google_event_id text not null,
  calendar_id text,

  added_by uuid references auth.users (id) on delete set null,
  added_at timestamptz not null default now(),

  unique (church_id, week_start, google_event_id)
);

create index if not exists announcement_email_queue_week_idx
  on public.announcement_email_queue (church_id, week_start);

alter table public.announcement_email_queue enable row level security;

drop policy if exists announcement_email_queue_select on public.announcement_email_queue;
create policy announcement_email_queue_select on public.announcement_email_queue
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

drop policy if exists announcement_email_queue_write on public.announcement_email_queue;
create policy announcement_email_queue_write on public.announcement_email_queue
  for all to authenticated
  using (church_id in (select public.user_church_ids()))
  with check (church_id in (select public.user_church_ids()));
