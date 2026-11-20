-- Staff can choose an email or text when a visitor writes through the church
-- website. The job only records that a message arrived (the submission id as
-- the event key); the visitor's name and message stay in the inbox.
alter table public.staff_notification_jobs
  drop constraint if exists staff_notification_jobs_event_check;

alter table public.staff_notification_jobs
  add constraint staff_notification_jobs_event_check
  check (event in ('attendance_documents', 'attendance_completed', 'kids_alerts', 'website_inbox'));
