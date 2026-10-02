-- First-time guests marked while counting Sunday attendance (per person, per
-- Sunday). Groups already store a count on group_attendance_records; weekly
-- attendance needs the people themselves so pastors can be told and guests
-- with a phone can get a welcome text.

alter table public.attendance_entries
  add column if not exists is_first_time_guest boolean not null default false;

comment on column public.attendance_entries.is_first_time_guest is
  'True when this person was marked as a first-time guest for this Sunday.';
