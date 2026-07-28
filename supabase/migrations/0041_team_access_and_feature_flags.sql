-- FaithForm: per-account feature flags + per-user feature permissions
-- Migration 0041

-- ---------------------------------------------------------------------------
-- ACCOUNT-LEVEL FEATURE FLAGS (managed by platform admins)
-- ---------------------------------------------------------------------------
-- A missing row means "use the catalog default" (enabled), so shipping a new
-- feature never requires backfilling every church.

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

-- Members may read their own church's flags (this drives nav + route guards).
-- Writes are platform-admin only and go through the service-role client.
drop policy if exists "church_features_select" on public.church_features;
create policy "church_features_select"
  on public.church_features
  for select
  to authenticated
  using (church_id in (select public.user_church_ids()));

-- ---------------------------------------------------------------------------
-- USER-LEVEL FEATURE PERMISSIONS (managed by church admins)
-- ---------------------------------------------------------------------------

alter table public.church_users
  add column if not exists feature_permissions text[] not null default '{}',
  add column if not exists invited_by uuid references auth.users (id) on delete set null,
  add column if not exists invited_at timestamptz;

-- ---------------------------------------------------------------------------
-- HELPERS
-- ---------------------------------------------------------------------------

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

-- Effective access: the church must have the feature turned on AND the user
-- must either be a church admin or hold an explicit grant.
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
-- ANNOUNCEMENTS: unsubmit support
-- ---------------------------------------------------------------------------
-- `status` already allows 'pending'; unsubmitting rewinds a published row to it.
-- These columns record who rewound it and when, so the audit trail survives.

alter table public.announcements
  add column if not exists unsubmitted_at timestamptz,
  add column if not exists unsubmitted_by uuid references auth.users (id) on delete set null;
