-- FaithForm dashboard hot-path indexes
-- Migration 0064
--
-- Each index below corresponds to a measured dashboard query shape. They are
-- intentionally narrow: no policy changes, no blanket foreign-key indexing,
-- and no indexes for tables already covered by a matching composite index.

-- Every authenticated dashboard request resolves the user's first church link
-- with this predicate and ordering. The existing user_id-only index still had
-- to sort the matching rows.
create index if not exists church_users_user_created_idx
  on public.church_users (user_id, created_at);

-- People and attendance roster screens filter the tenant + active state and
-- present the roster in name order. This also keeps inactive rows out of the
-- common scan without requiring a second partial index.
create index if not exists members_church_active_name_idx
  on public.members (church_id, is_active, last_name, first_name);

-- Giving KPI and fund summaries now read only succeeded gifts in a bounded
-- date range. The old separate (church_id, status) and
-- (church_id, created_at) indexes cannot satisfy both predicates together.
create index if not exists giving_donations_church_status_created_idx
  on public.giving_donations (church_id, status, created_at desc);
