-- Minimal Sermon Builder surface for tests/database/sermon-history.test.ts.
--
-- NOT a migration rehearsal. It creates only what migrations 0068 and 0075
-- reference — the Supabase roles, churches, and the three sermon tables with
-- the columns the projections read — so a plain Postgres can execute and
-- observe the sermon-notes functions. Everything is `if not exists`, so on a
-- database that already has the real tables this changes nothing.

create extension if not exists pgcrypto;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin;
  end if;
end $$;

create table if not exists public.churches (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  timezone text not null default 'America/New_York',
  created_at timestamptz not null default now()
);

do $$ begin
  create type sermon_status as enum ('draft', 'published');
exception when duplicate_object then null;
end $$;

do $$ begin
  create type sermon_asset_kind as enum (
    'discussion_questions', 'social_snippet', 'export_pdf', 'export_pptx'
  );
exception when duplicate_object then null;
end $$;

create table if not exists public.sermon_series (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  title text not null,
  theme text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sermons (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  created_by uuid,
  series_id uuid references public.sermon_series (id) on delete set null,
  title text not null default 'Untitled Sermon',
  scripture_refs text[] not null default '{}',
  topic text not null default '',
  status sermon_status not null default 'draft',
  content jsonb,
  outline jsonb,
  sermon_date date,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.sermon_assets (
  id uuid primary key default gen_random_uuid(),
  sermon_id uuid not null references public.sermons (id) on delete cascade,
  kind sermon_asset_kind not null,
  payload jsonb not null default '{}',
  created_at timestamptz not null default now()
);
