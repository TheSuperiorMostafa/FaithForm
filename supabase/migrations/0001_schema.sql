-- FaithForm: core schema (tables only)
-- Migration 0001

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- CORE MULTI-TENANT
-- ---------------------------------------------------------------------------

create table public.churches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- AUTH LINK
-- ---------------------------------------------------------------------------

create table public.church_users (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('admin', 'viewer')),
  created_at timestamptz not null default now(),
  unique (church_id, user_id)
);

-- ---------------------------------------------------------------------------
-- MEMBERS
-- ---------------------------------------------------------------------------

create table public.members (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  phone text,
  email text,
  photo_url text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ATTENDANCE
-- ---------------------------------------------------------------------------

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  service_date date not null,
  submitted_at timestamptz not null default now(),
  total_present int,
  total_absent int,
  notes text
);

create table public.attendance_entries (
  id uuid primary key default gen_random_uuid(),
  record_id uuid not null references public.attendance_records (id) on delete cascade,
  member_id uuid references public.members (id) on delete set null,
  church_id uuid not null references public.churches (id) on delete cascade,
  status text not null check (status in ('present', 'absent')),
  follow_up_requested boolean not null default false,
  unique (record_id, member_id)
);

-- ---------------------------------------------------------------------------
-- ANNOUNCEMENTS
-- ---------------------------------------------------------------------------

create table public.announcements (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  event_title text not null,
  event_date timestamptz,
  event_location text,
  push_to_app boolean not null default false,
  push_to_facebook boolean not null default false,
  push_to_team boolean not null default false,
  notes text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'published')),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ACTIVITY LOG (time tracking)
-- ---------------------------------------------------------------------------

create table public.activity_log (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  automation_type text,
  category text,
  task_name text,
  time_saved_minutes int,
  trigger_source text,
  executed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- PHONE CALLS
-- ---------------------------------------------------------------------------

create table public.phone_calls (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  caller_number text,
  call_type text,
  duration_seconds int,
  outcome text,
  sentiment text,
  ai_score numeric,
  transcript_url text,
  notes text,
  called_at timestamptz not null default now()
);
