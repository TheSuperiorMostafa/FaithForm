-- What 0167_sermon_media.sql references beyond tests/database/fixtures/bootstrap.sql.
-- Used by scripts/run-sermon-media-database-tests.mjs on a disposable database.

alter table public.stream_recordings add column if not exists deleted_at timestamptz;

create table if not exists public.sermons (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  title text not null default '',
  outline jsonb,
  status text not null default 'draft',
  updated_at timestamptz not null default now()
);

create schema if not exists storage;
create table if not exists storage.buckets (
  id text primary key,
  name text not null,
  public boolean not null default false,
  file_size_limit bigint,
  allowed_mime_types text[]
);
