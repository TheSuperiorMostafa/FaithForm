-- Media library: per-recording pages, series, tags, visibility and view stats
-- Migration 0047
--
-- The Media page was one long scroll of inline players. A church wants each
-- service to be its own page it can link to — with who preached, what was read,
-- whether it is listed publicly, and how many people actually watched.

-- ---------------------------------------------------------------------------
-- SERIES
-- ---------------------------------------------------------------------------

create table if not exists public.media_series (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists media_series_church_idx
  on public.media_series (church_id, name);

-- One series name per church; re-adding an existing name should reuse it.
create unique index if not exists media_series_church_name_idx
  on public.media_series (church_id, lower(name));

alter table public.media_series enable row level security;

drop policy if exists media_series_select on public.media_series;
create policy media_series_select on public.media_series
  for select to anon, authenticated
  using (true);

drop policy if exists media_series_write on public.media_series
;
create policy media_series_write on public.media_series
  for all to authenticated
  using (public.is_church_admin(church_id))
  with check (public.is_church_admin(church_id));

-- ---------------------------------------------------------------------------
-- RECORDING METADATA
-- ---------------------------------------------------------------------------
-- Tags are three separate arrays rather than one bag: a church filters by
-- speaker, by book/chapter and by topic independently, and keeping them apart
-- means the UI never has to guess which kind a tag is.

alter table public.stream_recordings
  add column if not exists series_id uuid
    references public.media_series (id) on delete set null,
  add column if not exists visibility text not null default 'public'
    check (visibility in ('public', 'unlisted')),
  add column if not exists speaker_tags text[] not null default '{}',
  add column if not exists chapter_tags text[] not null default '{}',
  add column if not exists topic_tags text[] not null default '{}';

create index if not exists stream_recordings_series_idx
  on public.stream_recordings (series_id, created_at desc);

-- ---------------------------------------------------------------------------
-- VIEWS
-- ---------------------------------------------------------------------------
-- One row per play. `kind` separates people who watched the service as it
-- happened from people who came back to it later — the two numbers mean
-- different things to a church, and adding them together hides both.

create table if not exists public.media_views (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  recording_id uuid references public.stream_recordings (id) on delete cascade,
  stream_session_id uuid references public.stream_sessions (id) on delete set null,

  kind text not null check (kind in ('live', 'replay')),
  source text not null default 'website'
    check (source in ('website', 'app', 'embed')),

  -- An opaque per-browser key, so repeat plays by one person can be collapsed
  -- into a unique-viewer count. Never an IP address and never joinable back to
  -- a person.
  viewer_key text,

  created_at timestamptz not null default now()
);

create index if not exists media_views_recording_idx
  on public.media_views (recording_id, created_at desc);

create index if not exists media_views_session_idx
  on public.media_views (stream_session_id, created_at desc);

create index if not exists media_views_church_idx
  on public.media_views (church_id, created_at desc);

alter table public.media_views enable row level security;

-- Churches read their own numbers. Writes come from the view beacon through the
-- service role, so visitors cannot inflate a count by posting directly.
drop policy if exists media_views_select on public.media_views;
create policy media_views_select on public.media_views
  for select to authenticated
  using (church_id in (select public.user_church_ids()));
