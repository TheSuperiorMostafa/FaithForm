-- Attendance follow-up message log
-- Migration 0046
--
-- attendance_entries records *that* someone was texted (a timestamp, an error),
-- but not what was said, or by whom. A pastor reviewing last Sunday needs the
-- actual wording — templates rotate per absence streak, so "we texted them" is
-- not enough to know what they received.
--
-- One row per attempt, kept even when the send failed: a failed follow-up is
-- exactly the one you need to see.

create table if not exists public.attendance_follow_up_log (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  -- The Sunday this follow-up belongs to. Denormalised from the attendance
  -- record so the log survives a record being re-cut, and so grouping by
  -- Sunday needs no join.
  service_date date not null,
  entry_id uuid references public.attendance_entries (id) on delete set null,
  member_id uuid references public.members (id) on delete set null,

  -- Captured at send time. Someone can be renamed or change numbers later; the
  -- log must keep showing who was actually contacted at what number.
  recipient_name text not null,
  recipient_phone text,

  message text not null,
  status text not null default 'sent'
    check (status in ('sent', 'failed', 'skipped')),
  error text,
  sms_id text,

  -- Who it came from: the line the text left on, and the staff member who
  -- pressed send.
  sender_phone text,
  sender_user_id uuid references auth.users (id) on delete set null,
  sender_name text,

  created_at timestamptz not null default now()
);

create index if not exists attendance_follow_up_log_church_date_idx
  on public.attendance_follow_up_log (church_id, service_date desc, created_at desc);

create index if not exists attendance_follow_up_log_member_idx
  on public.attendance_follow_up_log (member_id, created_at desc);

alter table public.attendance_follow_up_log enable row level security;

drop policy if exists attendance_follow_up_log_select on public.attendance_follow_up_log;
create policy attendance_follow_up_log_select on public.attendance_follow_up_log
  for select to authenticated
  using (
    exists (
      select 1
      from public.church_users cu
      where cu.user_id = auth.uid()
        and cu.church_id = attendance_follow_up_log.church_id
    )
  );

-- Writes go through the service role in the send path, so no insert policy for
-- ordinary users on purpose.
