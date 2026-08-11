-- FaithForm: separate Attendance and Follow-up access
-- Migration 0043
--
-- Follow-up needs no new storage of its own — it is a feature key, and grants
-- live in church_users.feature_permissions (added by 0041).
--
-- This also repairs a partially-applied history. An audit of production found
-- 0014 had never run at all and 0041 only in part, so the columns below were
-- missing: reading a service's follow-up state failed outright ("column
-- attendance_entries.follow_up_sent_at does not exist"), which is why no
-- follow-up ever appeared to send, and no per-member feature grant could be
-- stored. Every statement is idempotent, so applying this on a database that
-- did receive 0014 and 0041 changes nothing.

-- ---------------------------------------------------------------------------
-- ATTENDANCE FOLLOW-UP DELIVERY TRACKING (from 0014 — re-applied idempotently)
-- ---------------------------------------------------------------------------

alter table public.attendance_entries
  add column if not exists follow_up_sent_at timestamptz,
  add column if not exists follow_up_error text;

alter table public.announcements
  add column if not exists facebook_scheduled_publish_time timestamptz;

-- ---------------------------------------------------------------------------
-- USER-LEVEL FEATURE PERMISSIONS (from 0041 — re-applied idempotently)
-- ---------------------------------------------------------------------------

alter table public.church_users
  add column if not exists feature_permissions text[] not null default '{}',
  add column if not exists invited_by uuid references auth.users (id) on delete set null,
  add column if not exists invited_at timestamptz;

-- ---------------------------------------------------------------------------
-- ACCOUNT-LEVEL FEATURE FLAGS (from 0041 — re-applied idempotently)
-- ---------------------------------------------------------------------------

create table if not exists public.church_features (
  church_id uuid not null references public.churches (id) on delete cascade,
  feature_key text not null,
  enabled boolean not null default true,
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  primary key (church_id, feature_key)
);

create index if not exists church_features_church_id_idx
  on public.church_features (church_id);

alter table public.church_features enable row level security;

drop policy if exists "church_features_select" on public.church_features;
create policy "church_features_select"
  on public.church_features
  for select
  to authenticated
  using (church_id in (select public.user_church_ids()));

create or replace function public.church_feature_enabled(
  target_church_id uuid,
  feature text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (
      select f.enabled
      from public.church_features f
      where f.church_id = target_church_id
        and f.feature_key = feature
    ),
    true
  )
$$;

create or replace function public.user_has_feature(
  target_church_id uuid,
  feature text
)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.church_feature_enabled(target_church_id, feature)
    and exists (
      select 1
      from public.church_users cu
      where cu.user_id = auth.uid()
        and cu.church_id = target_church_id
        and (cu.role = 'admin' or feature = any (cu.feature_permissions))
    )
$$;

-- ---------------------------------------------------------------------------
-- ANNOUNCEMENTS: unsubmit support (from 0041 — re-applied idempotently)
-- ---------------------------------------------------------------------------

alter table public.announcements
  add column if not exists unsubmitted_at timestamptz,
  add column if not exists unsubmitted_by uuid references auth.users (id) on delete set null;

-- ---------------------------------------------------------------------------
-- FOLLOW-UP SPLIT
-- ---------------------------------------------------------------------------
-- Attendance is submitted without choosing follow-ups; the pastor picks them
-- afterwards on the Follow-up page. `attendance_entries.follow_up_requested`
-- already stores exactly that and already defaults to false, so the split
-- needs no schema change — only the `attendance_follow_up` grant, which is
-- a value in the array added above.
--
-- Nothing is backfilled: Follow-up is deliberately handed out, and church
-- admins hold every feature implicitly.
