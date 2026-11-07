-- A directory classification, independent of active/inactive and app identity.
-- Existing people stay Unknown until church staff chooses a status.
alter table public.members
  add column if not exists membership_status text not null default 'unknown'
  constraint members_membership_status_check check (
    membership_status in ('member', 'regular_attender', 'newcomer', 'visitor', 'former', 'unknown')
  );

-- Keep admin-only direct writes unchanged. The People server actions authorize
-- a People grant and permit only named basic fields through a church-scoped
-- server client; this does not grant staff arbitrary access to care/identity fields.
