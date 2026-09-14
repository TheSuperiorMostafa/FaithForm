-- Let signed-in sessions execute the helpers their own row-level security calls.
--
-- ## The bug
--
-- 0004 revoked EXECUTE on `user_church_ids()` and `is_church_admin(uuid)` from
-- `authenticated`, and 0053 did the same for `current_visitor_account_id()` and
-- `is_church_staff(uuid)`, on the belief that "SECURITY DEFINER functions can
-- always be invoked from within other SQL statements regardless of EXECUTE
-- grants". Postgres does not work that way: a function named in a policy is
-- called as the querying role, and that role needs EXECUTE. SECURITY DEFINER
-- changes whose privileges the body runs with, not who may call it.
--
-- A database built from these migrations therefore cannot open the dashboard:
-- the first `church_users` read fails with
-- `permission denied for function user_church_ids`. Production works only
-- because its grants were not left the way the migration files leave them — so
-- a new staging project, or a restore rebuilt from source, would break. It was
-- found by standing up a local stack from the migrations and signing in as a
-- church admin.
--
-- ## Why granting is safe
--
-- Each helper answers a question about the caller and nobody else — which
-- churches am I in, am I an admin or staff of this church, which visitor
-- account is mine — so calling one directly over /rest/v1/rpc reveals nothing
-- the caller's own session could not already read. `anon` stays revoked: no
-- signed-out policy needs them.
--
-- On a database that already has these grants this is a no-op.

grant execute on function public.user_church_ids() to authenticated;
grant execute on function public.is_church_admin(uuid) to authenticated;
grant execute on function public.is_church_staff(uuid) to authenticated;
grant execute on function public.current_visitor_account_id() to authenticated;
