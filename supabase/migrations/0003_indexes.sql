-- FaithForm: indexes
-- Migration 0003

-- church_id indexes
create index idx_church_users_church_id on public.church_users (church_id);
create index idx_members_church_id on public.members (church_id);
create index idx_attendance_records_church_id on public.attendance_records (church_id);
create index idx_attendance_entries_church_id on public.attendance_entries (church_id);
create index idx_announcements_church_id on public.announcements (church_id);
create index idx_activity_log_church_id on public.activity_log (church_id);
create index idx_phone_calls_church_id on public.phone_calls (church_id);

-- date / time indexes
create index idx_attendance_records_church_service_date
  on public.attendance_records (church_id, service_date desc);

create index idx_attendance_records_submitted_at
  on public.attendance_records (submitted_at desc);

create index idx_announcements_church_event_date
  on public.announcements (church_id, event_date desc);

create index idx_activity_log_church_executed_at
  on public.activity_log (church_id, executed_at desc);

create index idx_phone_calls_church_called_at
  on public.phone_calls (church_id, called_at desc);

create index idx_members_created_at
  on public.members (created_at desc);

-- lookup indexes
create index idx_attendance_entries_record_id on public.attendance_entries (record_id);
create index idx_attendance_entries_member_id on public.attendance_entries (member_id);
create index idx_church_users_user_id on public.church_users (user_id);
