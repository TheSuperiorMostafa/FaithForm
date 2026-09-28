-- A human can resolve an uncertain support alert after checking the inbox and
-- contacting the church as needed. Keep that outcome distinct from provider
-- acceptance: review does not prove the original email was delivered.
alter table public.support_tickets
  add column notification_email_reviewed_at timestamptz,
  add column notification_email_reviewed_by uuid;
alter table public.support_tickets
  drop constraint support_tickets_notification_email_status_check;
alter table public.support_tickets
  add constraint support_tickets_notification_email_status_check
  check (notification_email_status in ('pending', 'sent', 'unconfirmed', 'reviewed'));
alter table public.support_tickets
  add constraint support_tickets_notification_email_review_check
  check (notification_email_status <> 'reviewed' or
    (notification_email_reviewed_at is not null and notification_email_reviewed_by is not null));

-- The original ticket migration relied on a SELECT-only RLS policy, but
-- Supabase still granted browser roles table-wide writes. Restrict grants as
-- well, so new status and audit columns cannot become browser-writable if a
-- future policy is added. The legacy table-wide SELECT grant also exposed
-- private admin_notes. Grant churches only the fields their Help page reads.
-- All ticket writes already use the service role.
revoke all privileges on table public.support_tickets
  from public, anon, authenticated;
grant select (id, church_id, submitted_by, subject, body, status, priority,
  created_at, updated_at) on table public.support_tickets to authenticated;
grant select, insert, update, delete on table public.support_tickets
  to service_role;

alter table public.support_ticket_comments
  add column notification_email_reviewed_at timestamptz,
  add column notification_email_reviewed_by uuid;
alter table public.support_ticket_comments
  drop constraint support_ticket_comments_notification_email_status_check;
alter table public.support_ticket_comments
  add constraint support_ticket_comments_notification_email_status_check
  check (notification_email_status in ('pending', 'sent', 'unconfirmed', 'reviewed'));
alter table public.support_ticket_comments
  add constraint support_ticket_comments_notification_email_review_check
  check (notification_email_status <> 'reviewed' or
    (notification_email_reviewed_at is not null and notification_email_reviewed_by is not null));

-- The church conversation does not need internal email outcomes or reviewer
-- identifiers. Keep its visible fields selectable under the existing tenant
-- RLS policy, and leave all fields available to the service role.
revoke all privileges on table public.support_ticket_comments
  from public, anon, authenticated;
grant select (id, ticket_id, church_id, author_role, author_name, body,
  created_at) on table public.support_ticket_comments to authenticated;
