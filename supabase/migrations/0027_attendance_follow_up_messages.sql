alter table public.church_settings
  add column if not exists attendance_follow_up_messages jsonb;
