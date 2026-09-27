-- The legacy status view was created by the migration owner, so PostgreSQL
-- evaluated its underlying announcements read with that owner's permissions.
-- Keep the view and its columns, but require the caller's table privileges and
-- church row policy. No application query currently depends on this view.
alter view public.announcements_with_status set (security_invoker = true);
