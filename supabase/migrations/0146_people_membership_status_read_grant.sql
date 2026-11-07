-- 0110 deliberately replaced table-wide members SELECT with named columns.
-- 0142 added this directory field after that allowlist, so authenticated People
-- reads otherwise fail with 23501 instead of returning the existing directory.
-- Grant only the new classification; retain feature/church RLS and all other
-- column restrictions (in particular, medical notes remain server-only).
grant select (membership_status) on table public.members to authenticated;
