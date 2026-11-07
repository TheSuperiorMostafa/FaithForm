-- Availability belongs to the existing church/group membership, never a caller-supplied person.
alter table public.group_memberships add column if not exists availability text not null default '';
alter table public.group_memberships add constraint group_memberships_availability_length check (char_length(availability) <= 500);
-- Existing RLS and write grants remain unchanged: the authorized server owns writes.
notify pgrst, 'reload schema';
