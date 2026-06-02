-- Attendance follow-up delivery tracking + Facebook scheduled publish time

alter table public.attendance_entries
  add column if not exists follow_up_sent_at timestamptz,
  add column if not exists follow_up_error text;

alter table public.announcements
  add column if not exists facebook_scheduled_publish_time timestamptz;
