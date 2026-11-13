-- A pastor can set when a service happened without changing recorder/ingest
-- evidence. Existing rows keep their exact dates until an explicit date edit.
-- Keep the public recorded_at timestamptz contract: a date override resolves to
-- noon in the church's zone so all current website and app clients show that day.
-- Archive cursors stay publication-based; date edits cannot break pagination.
-- CREATE OR REPLACE preserves the existing server-only EXECUTE grants and every
-- visibility, tenant, readiness and deletion guard in the canonical projections.
begin;
set local lock_timeout = '5s';

alter table public.stream_recordings
  add column service_date date
  constraint stream_recordings_service_date_valid
  check (service_date is null or service_date between date '0001-01-01' and date '9999-12-31');

comment on column public.stream_recordings.service_date is
  'Optional pastor-selected service day. Null uses recording_started_at then created_at; never changes ingest/lifecycle timestamps.';

create or replace function public.mobile_media_archive(
  p_church_slug text,
  p_relationship_state text,
  p_query text default null,
  p_cursor_published timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 20
)
returns table (
  id uuid,
  title text,
  summary text,
  published_at timestamptz,
  recorded_at timestamptz,
  duration_sec numeric,
  poster_url text,
  series_name text,
  speakers text[],
  publication_version integer,
  church_name text,
  church_timezone text,
  cursor_published timestamptz,
  cursor_id uuid,
  tile_poster_url text,
  series_slug text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.id,
    coalesce(nullif(r.title, ''), 'Service recording') as title,
    r.mobile_summary,
    r.mobile_published_at,
    coalesce((r.service_date + time '12:00') at time zone c.timezone, r.recording_started_at, r.created_at),
    case
      when r.trim_end_sec is not null then greatest(0, r.trim_end_sec - r.trim_start_sec)
      when r.duration_sec is not null then greatest(0, r.duration_sec - r.trim_start_sec)
      else null
    end as duration_sec,
    coalesce(
      r.artwork_wide_url, ms.artwork_wide_url,
      r.mobile_poster_url, e.mobile_poster_url, e.artwork_url, r.auto_poster_url
    ) as poster_url,
    ms.name as series_name,
    r.speaker_tags,
    r.mobile_publication_version,
    c.name,
    c.timezone,
    r.mobile_published_at as cursor_published,
    r.id as cursor_id,
    coalesce(r.artwork_poster_url, ms.artwork_poster_url) as tile_poster_url,
    ms.slug as series_slug
  from public.stream_recordings r
  join public.churches c on c.id = r.church_id
  left join public.media_series ms on ms.id = r.series_id
  left join public.stream_events e on e.id = r.stream_event_id
  where c.slug = p_church_slug
    and p_relationship_state is distinct from 'blocked'
    and r.status = 'ready'
    and r.deleted_at is null
    and r.mobile_playable
    and r.mobile_visibility <> 'none'
    and r.mobile_published_at is not null
    and r.mobile_unpublished_at is null
    and (
      r.mobile_visibility = 'public'
      or (r.mobile_visibility = 'followers'
          and p_relationship_state in ('following', 'joined'))
      or (r.mobile_visibility = 'members'
          and p_relationship_state = 'joined')
    )
    and (
      p_query is null
      or length(btrim(p_query)) = 0
      or coalesce(r.title, '') ilike '%' || btrim(p_query) || '%'
      or coalesce(r.mobile_summary, '') ilike '%' || btrim(p_query) || '%'
      or coalesce(ms.name, '') ilike '%' || btrim(p_query) || '%'
      or exists (
        select 1 from unnest(r.speaker_tags) as speaker
         where speaker ilike '%' || btrim(p_query) || '%'
      )
    )
    and (
      p_cursor_id is null
      or (r.mobile_published_at, r.id) < (p_cursor_published, p_cursor_id)
    )
  order by r.mobile_published_at desc, r.id desc
  limit greatest(1, least(50, p_limit));
$$;

create or replace function public.mobile_media_detail(
  p_church_slug text,
  p_relationship_state text,
  p_recording_id uuid
)
returns table (
  id uuid,
  title text,
  summary text,
  published_at timestamptz,
  recorded_at timestamptz,
  duration_sec numeric,
  trim_start_sec numeric,
  poster_url text,
  series_name text,
  speakers text[],
  chapters text[],
  topics text[],
  publication_version integer,
  church_name text,
  church_timezone text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.id,
    coalesce(nullif(r.title, ''), 'Service recording'),
    r.mobile_summary,
    r.mobile_published_at,
    coalesce((r.service_date + time '12:00') at time zone c.timezone, r.recording_started_at, r.created_at),
    case
      when r.trim_end_sec is not null then greatest(0, r.trim_end_sec - r.trim_start_sec)
      when r.duration_sec is not null then greatest(0, r.duration_sec - r.trim_start_sec)
      else null
    end,
    -- A segmented recording's playlist starts at the trim; a file starts at 0.
    case when r.source_kind = 'segments' then 0::numeric else r.trim_start_sec end,
    coalesce(
      r.artwork_wide_url, ms.artwork_wide_url,
      r.mobile_poster_url, e.mobile_poster_url, e.artwork_url, r.auto_poster_url
    ),
    ms.name,
    r.speaker_tags,
    r.chapter_tags,
    r.topic_tags,
    r.mobile_publication_version,
    c.name,
    c.timezone
  from public.stream_recordings r
  join public.churches c on c.id = r.church_id
  left join public.media_series ms on ms.id = r.series_id
  left join public.stream_events e on e.id = r.stream_event_id
  where c.slug = p_church_slug
    and r.id = p_recording_id
    and p_relationship_state is distinct from 'blocked'
    and r.status = 'ready'
    and r.deleted_at is null
    and r.mobile_playable
    and r.mobile_visibility <> 'none'
    and r.mobile_published_at is not null
    and r.mobile_unpublished_at is null
    and (
      r.mobile_visibility = 'public'
      or (r.mobile_visibility = 'followers'
          and p_relationship_state in ('following', 'joined'))
      or (r.mobile_visibility = 'members'
          and p_relationship_state = 'joined')
    );
$$;

create or replace function public.mobile_media_series_items(
  p_church_slug text,
  p_relationship_state text,
  p_series_slug text
)
returns table (
  id uuid,
  title text,
  summary text,
  published_at timestamptz,
  recorded_at timestamptz,
  duration_sec numeric,
  poster_url text,
  wide_url text,
  speakers text[],
  publication_version integer
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.id,
    coalesce(nullif(r.title, ''), 'Service recording') as title,
    r.mobile_summary,
    r.mobile_published_at,
    coalesce((r.service_date + time '12:00') at time zone c.timezone, r.recording_started_at, r.created_at),
    case
      when r.trim_end_sec is not null then greatest(0, r.trim_end_sec - r.trim_start_sec)
      when r.duration_sec is not null then greatest(0, r.duration_sec - r.trim_start_sec)
      else null
    end as duration_sec,
    coalesce(r.artwork_poster_url, ms.artwork_poster_url) as poster_url,
    coalesce(
      r.artwork_wide_url, ms.artwork_wide_url,
      r.mobile_poster_url, e.mobile_poster_url, e.artwork_url, r.auto_poster_url
    ) as wide_url,
    r.speaker_tags,
    r.mobile_publication_version
  from public.stream_recordings r
  join public.churches c on c.id = r.church_id
  join public.media_series ms on ms.id = r.series_id
  left join public.stream_events e on e.id = r.stream_event_id
  where c.slug = p_church_slug
    and ms.slug = p_series_slug
    and ms.church_id = c.id
    and p_relationship_state is distinct from 'blocked'
    and r.status = 'ready'
    and r.deleted_at is null
    and r.mobile_playable
    and r.mobile_visibility <> 'none'
    and r.mobile_published_at is not null
    and r.mobile_unpublished_at is null
    and (
      r.mobile_visibility = 'public'
      or (r.mobile_visibility = 'followers'
          and p_relationship_state in ('following', 'joined'))
      or (r.mobile_visibility = 'members'
          and p_relationship_state = 'joined')
    )
  order by coalesce((r.service_date + time '12:00') at time zone c.timezone, r.recording_started_at, r.created_at) asc, r.mobile_published_at asc, r.id asc;
$$;

create or replace function public.web_recordings(
  p_church_slug text,
  p_recording_id uuid default null,
  p_limit integer default 24
)
returns table (
  id uuid,
  church_id uuid,
  title text,
  summary text,
  recorded_at timestamptz,
  duration_sec numeric,
  poster_url text,
  series_name text,
  speakers text[],
  chapters text[],
  topics text[],
  listed boolean,
  source_kind text,
  storage_path text,
  trim_start_sec numeric,
  published_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    r.id,
    r.church_id,
    coalesce(nullif(r.title, ''), 'Service recording'),
    r.mobile_summary,
    coalesce((r.service_date + time '12:00') at time zone c.timezone, r.recording_started_at, r.created_at),
    case
      when r.trim_end_sec is not null then greatest(0, r.trim_end_sec - r.trim_start_sec)
      when r.duration_sec is not null then greatest(0, r.duration_sec - r.trim_start_sec)
      else null
    end,
    coalesce(
      r.artwork_wide_url, ms.artwork_wide_url,
      r.mobile_poster_url, e.mobile_poster_url, e.artwork_url, r.auto_poster_url
    ),
    ms.name,
    r.speaker_tags,
    r.chapter_tags,
    r.topic_tags,
    coalesce(r.visibility, 'public') = 'public',
    r.source_kind,
    r.storage_path,
    r.trim_start_sec,
    r.web_published_at
  from public.stream_recordings r
  join public.churches c on c.id = r.church_id
  left join public.media_series ms on ms.id = r.series_id
  left join public.stream_events e on e.id = r.stream_event_id
  where c.slug = p_church_slug
    and r.status = 'ready'
    and r.deleted_at is null
    and r.mobile_playable
    and r.web_published_at is not null
    and r.web_unpublished_at is null
    and (
      (p_recording_id is not null and r.id = p_recording_id)
      -- A list only carries listed recordings; an unlisted one is reachable by
      -- its link and nowhere else.
      or (p_recording_id is null and coalesce(r.visibility, 'public') = 'public')
    )
  order by coalesce((r.service_date + time '12:00') at time zone c.timezone, r.recording_started_at, r.created_at) desc, r.web_published_at desc, r.id desc
  limit greatest(1, least(100, p_limit));
$$;

-- Date-only edits invalidate existing app media caches just like title edits.
create or replace function public.bump_stream_recording_mobile_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.service_date is distinct from old.service_date
     or new.title is distinct from old.title
     or new.mobile_summary is distinct from old.mobile_summary
     or new.duration_sec is distinct from old.duration_sec
     or new.status is distinct from old.status
     or new.series_id is distinct from old.series_id
     or new.speaker_tags is distinct from old.speaker_tags
     or new.mobile_poster_url is distinct from old.mobile_poster_url
     or new.artwork_poster_url is distinct from old.artwork_poster_url
     or new.artwork_wide_url is distinct from old.artwork_wide_url
     or new.artwork_banner_url is distinct from old.artwork_banner_url
     or new.mobile_visibility is distinct from old.mobile_visibility
     or new.mobile_published_at is distinct from old.mobile_published_at
     or new.mobile_unpublished_at is distinct from old.mobile_unpublished_at
     or new.mobile_revoked_at is distinct from old.mobile_revoked_at
     or new.mobile_playable is distinct from old.mobile_playable
     -- P15: a trim changes what a phone plays and how long it says it is.
     or new.trim_start_sec is distinct from old.trim_start_sec
     or new.trim_end_sec is distinct from old.trim_end_sec
     or new.deleted_at is distinct from old.deleted_at
  then
    new.mobile_publication_version := coalesce(old.mobile_publication_version, 1) + 1;
  end if;
  return new;
end;
$$;

notify pgrst, 'reload schema';
commit;

