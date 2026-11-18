-- 0110 deliberately replaced table-wide members SELECT with named columns.
-- 0168 added two directory fields after that allowlist, so authenticated People
-- reads that name them would otherwise fail. Grant only these two fields, as
-- 0146 did for membership_status; feature/church RLS and every other column
-- restriction (in particular, medical notes remain server-only) are unchanged.
grant select (address, gender) on table public.members to authenticated;
