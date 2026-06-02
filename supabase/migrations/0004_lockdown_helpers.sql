-- FaithForm: harden RLS helpers
-- Migration 0004
--
-- The helpers in 0002_rls_policies.sql are SECURITY DEFINER and only ever
-- need to run as part of RLS policy evaluation, not from PostgREST. Revoke
-- EXECUTE so clients cannot call them directly via /rest/v1/rpc/*.
-- Policies still work because SECURITY DEFINER functions can always be
-- invoked from within other SQL statements regardless of EXECUTE grants.

revoke execute on function public.user_church_ids() from public, anon, authenticated;
revoke execute on function public.is_church_admin(uuid) from public, anon, authenticated;
