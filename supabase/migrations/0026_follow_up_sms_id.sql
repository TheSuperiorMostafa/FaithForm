alter table public.attendance_entries
  add column if not exists follow_up_sms_id text;
