-- Media artwork, and series promoted from a label to a collection
-- Migration 0080
--
-- Additive. Columns on two existing tables, one backfill of series slugs, and
-- three projection functions. No policy, grant or RLS change on anything
-- migration 0050 secured, so the baseline stays the owner of all of that.
--
-- ## Why artwork is three columns and not one
--
-- The media library renders in four different shapes: a vertical tile in a
-- shelf, a wide still in a hero or a list row, a broad banner across the top of
-- a series page, and a square in a Now Playing view. One image cannot serve all
-- four. Centre-cropping a 16:9 still into a 4:5 tile cuts the preacher's head
-- off; letterboxing a 4:5 tile into a hero leaves two grey bars.
--
-- So a church supplies up to three crops and we never guess: `poster` (4:5),
-- `wide` (16:9) and `banner` (~2.76:1). These are the aspects
-- `design/faithform/tokens.json` already committed to, which is what lets the
-- native apps render from generated constants rather than from a per-screen
-- decision someone makes twice.
--
-- ## Why series carries artwork too, and why that matters more than the item
--
-- A church publishes forty items a year and runs six series. Asking for three
-- crops per item is asking for a hundred and twenty images nobody will make,
-- and the library stays grey. Asking for three crops per *series* is asking for
-- eighteen, and every item inside inherits them.
--
-- Inheritance is resolved in SQL, at read time, rather than copied onto the
-- item at write time. Copying would mean re-running a backfill every time a
-- church rebrands a series, and would leave items silently stale when it
-- failed. `coalesce(item, series, legacy poster)` cannot go stale.
--
-- ## Why there is no series publication flag
--
-- A series is visible exactly when it contains something visible. A separate
-- `series.mobile_visibility` would be a second source of truth able to disagree
-- with the items underneath it — a published series holding nothing anyone can
-- watch, or a hidden series whose items are all public and reachable by
-- direct link anyway. The projections below derive series visibility from the
-- items, so the two can never contradict each other.

-- ---------------------------------------------------------------------------
-- SERIES: ARTWORK, SLUG, DESCRIPTION SURFACE
-- ---------------------------------------------------------------------------

alter table public.media_series
  add column if not exists artwork_poster_url text,
  add column if not exists artwork_wide_url text,
  add column if not exists artwork_banner_url text;

-- A series is a page now, so it needs a stable, linkable name that is not its
-- uuid and does not change when someone fixes the capitalisation of the title.
alter table public.media_series
  add column if not exists slug text,
  add column if not exists mobile_publication_version integer not null default 1;

-- Backfill: slugify the name, then de-duplicate with a counter. Done in plpgsql
-- rather than one clever update because the uniqueness has to hold *within* the
-- backfill, not just after it — two series called "Rooted" and "rooted!" both
-- slugify to `rooted`.
do $$
declare
  row_record record;
  base_slug text;
  candidate text;
  suffix integer;
begin
  for row_record in
    select id, church_id, name
      from public.media_series
     where slug is null
     order by created_at asc, id asc
  loop
    base_slug := regexp_replace(lower(btrim(row_record.name)), '[^a-z0-9]+', '-', 'g');
    base_slug := btrim(base_slug, '-');
    if base_slug is null or base_slug = '' then
      base_slug := 'series';
    end if;
    base_slug := left(base_slug, 60);
    candidate := base_slug;

    suffix := 1;
    while exists (
      select 1 from public.media_series s
       where s.church_id = row_record.church_id
         and s.slug = candidate
    ) loop
      suffix := suffix + 1;
      candidate := left(base_slug, 60 - length(suffix::text) - 1)
                   || '-' || suffix::text;
    end loop;

    update public.media_series set slug = candidate where id = row_record.id;
  end loop;
end $$;

-- Every series is addressable after the backfill. Leaving this nullable would
-- allow a direct insert to create a collection the dashboard can never open.
alter table public.media_series
  alter column slug set not null;

create unique index if not exists media_series_church_slug_idx
  on public.media_series (church_id, slug);

-- ---------------------------------------------------------------------------
-- RECORDINGS: PER-ITEM ARTWORK OVERRIDE
-- ---------------------------------------------------------------------------
--
-- Optional by design. The expected steady state is null on most items, with the
-- series supplying the image. These columns exist for the one talk in a series
-- that deserves its own picture, and for churches with no series at all.

alter table public.stream_recordings
  add column if not exists artwork_poster_url text,
  add column if not exists artwork_wide_url text,
  add column if not exists artwork_banner_url text;

-- The bump trigger from 0060 names exactly the fields a phone renders, so the
-- new artwork columns have to be added to it or a church could change a series
-- image and have every device keep serving the old one from cache.
--
-- Series artwork is deliberately *not* in this trigger: it lives on another
-- table, and a trigger here cannot see it. `mobile_media_version` below folds
-- the series table in instead, which is the only place that can.
create or replace function public.bump_stream_recording_mobile_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.title is distinct from old.title
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
  then
    new.mobile_publication_version := coalesce(old.mobile_publication_version, 1) + 1;
  end if;
  return new;
end;
$$;

-- Series edits need both the ordinary audit timestamp and a small integer the
-- mobile ETag can fold in. Nothing maintained either value on this table before.
create or replace function public.touch_media_series_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  -- Unlike a timestamp-derived count, this advances on every edit, including
  -- the second and third time a church replaces the same artwork. The mobile
  -- list ETag folds this value in below.
  new.mobile_publication_version := coalesce(old.mobile_publication_version, 1) + 1;
  return new;
end;
$$;

drop trigger if exists media_series_touch_updated_at on public.media_series;
create trigger media_series_touch_updated_at
  before update on public.media_series
  for each row execute function public.touch_media_series_updated_at();

-- ---------------------------------------------------------------------------
-- THE SERIES SHELF
-- ---------------------------------------------------------------------------

/*
 * Series that contain something this visitor may watch, newest activity first.
 *
 * Visibility is derived, never declared: a series appears because a recording
 * inside it passed exactly the filters `mobile_media_archive` applies, counted
 * by the same predicate. A series whose every item is unpublished returns no
 * row, so a shelf cannot show a collection that opens onto an empty page.
 *
 * `item_count` is the count of *visible* items, not of items, so the tile can
 * say "8 messages" and have that number survive the visitor tapping it.
 */
create or replace function public.mobile_media_series(
  p_church_slug text,
  p_relationship_state text,
  p_limit integer default 20
)
returns table (
  id uuid,
  slug text,
  name text,
  description text,
  artwork_poster_url text,
  artwork_wide_url text,
  artwork_banner_url text,
  item_count bigint,
  latest_published_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    ms.id,
    ms.slug,
    ms.name,
    ms.description,
    ms.artwork_poster_url,
    ms.artwork_wide_url,
    ms.artwork_banner_url,
    count(r.id) as item_count,
    max(r.mobile_published_at) as latest_published_at
  from public.media_series ms
  join public.churches c on c.id = ms.church_id
  join public.stream_recordings r
    on r.series_id = ms.id
   and r.status = 'ready'
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
  where c.slug = p_church_slug
    and p_relationship_state is distinct from 'blocked'
  group by ms.id, ms.slug, ms.name, ms.description,
           ms.artwork_poster_url, ms.artwork_wide_url, ms.artwork_banner_url
  order by max(r.mobile_published_at) desc nulls last, ms.name asc
  limit greatest(1, least(50, p_limit));
$$;

revoke all on function public.mobile_media_series(text, text, integer)
  from public, anon, authenticated;
grant execute on function public.mobile_media_series(text, text, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- ONE SERIES, WITH ITS ITEMS
-- ---------------------------------------------------------------------------

/*
 * The items inside one series, oldest first.
 *
 * Oldest first on purpose, and it is the one list in this file that is not
 * newest-first: a series is taught in order and a visitor arriving at part one
 * wants part two next. The archive is a feed; a series is a course.
 *
 * Resolved artwork, not raw columns — the item's own crop wins, the series
 * supplies the fallback, and the legacy 0060 poster fields are the last resort
 * so recordings published before this migration keep the image they had.
 */
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
    r.created_at,
    case
      when r.trim_end_sec is not null then greatest(0, r.trim_end_sec - r.trim_start_sec)
      when r.duration_sec is not null then greatest(0, r.duration_sec - r.trim_start_sec)
      else null
    end as duration_sec,
    coalesce(r.artwork_poster_url, ms.artwork_poster_url) as poster_url,
    coalesce(
      r.artwork_wide_url, ms.artwork_wide_url,
      r.mobile_poster_url, e.mobile_poster_url, e.artwork_url
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
  order by r.mobile_published_at asc, r.id asc;
$$;

revoke all on function public.mobile_media_series_items(text, text, text)
  from public, anon, authenticated;
grant execute on function public.mobile_media_series_items(text, text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- VERSION, WIDENED TO COVER SERIES ARTWORK
-- ---------------------------------------------------------------------------

/*
 * Replaces the 0060 definition.
 *
 * 0060 took the max publication version across a church's published items.
 * That was complete when artwork lived only on the item. Now a church can
 * change a series image and alter what forty items look like without touching
 * any of their rows, so the series table has to contribute to the ETag or every
 * device serves stale tiles until something unrelated happens to bump a
 * version.
 *
 * Series carry their own publication version. The update trigger increments it
 * on every edit, so replacing artwork repeatedly always changes the validator.
 * Only series containing something this relationship may see contribute: an
 * anonymous visitor must not get a cache side channel for a members-only set.
 */
create or replace function public.mobile_media_version(
  p_church_slug text,
  p_relationship_state text
)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(sum(v), 0)::integer from (
    select max(r.mobile_publication_version) as v
      from public.stream_recordings r
      join public.churches c on c.id = r.church_id
     where c.slug = p_church_slug
       and p_relationship_state is distinct from 'blocked'
       and r.mobile_visibility <> 'none'
    union all
    select max(e.mobile_publication_version)
      from public.stream_events e
      join public.churches c on c.id = e.church_id
     where c.slug = p_church_slug
       and p_relationship_state is distinct from 'blocked'
       and e.mobile_visibility <> 'none'
    union all
    select max(ms.mobile_publication_version)
      from public.media_series ms
      join public.churches c on c.id = ms.church_id
     where c.slug = p_church_slug
       and p_relationship_state is distinct from 'blocked'
       and exists (
         select 1
           from public.stream_recordings r
          where r.series_id = ms.id
            and r.status = 'ready'
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
       )
  ) versions;
$$;

revoke all on function public.mobile_media_version(text, text)
  from public, anon, authenticated;
grant execute on function public.mobile_media_version(text, text)
  to service_role;

-- ---------------------------------------------------------------------------
-- ARCHIVE, WIDENED TO RETURN RESOLVED ARTWORK
-- ---------------------------------------------------------------------------

/*
 * Replaces the 0060 definition. Same filters, same keyset, same ordering —
 * the only change is that it now returns `poster_url` and `wide_url` resolved
 * through the item-then-series-then-legacy chain, plus the series slug so a
 * tile can link to the collection it belongs to.
 *
 * The 0060 argument signature is preserved and the old `poster_url` column
 * keeps its name and position, so a caller that has not been updated still
 * gets a usable wide image from the same call.
 *
 * Dropped and recreated rather than replaced: `create or replace function`
 * refuses to change a return type, and this adds two columns to the returned
 * table. The drop is safe because the only caller is service-role server code
 * deployed alongside this migration.
 */
drop function if exists public.mobile_media_archive(
  text, text, text, timestamptz, uuid, integer
);

create function public.mobile_media_archive(
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
    r.created_at,
    case
      when r.trim_end_sec is not null then greatest(0, r.trim_end_sec - r.trim_start_sec)
      when r.duration_sec is not null then greatest(0, r.duration_sec - r.trim_start_sec)
      else null
    end as duration_sec,
    -- Unchanged meaning: the wide still. Resolution order now prefers an
    -- explicit 16:9 crop over the legacy single poster field.
    coalesce(
      r.artwork_wide_url, ms.artwork_wide_url,
      r.mobile_poster_url, e.mobile_poster_url, e.artwork_url
    ) as poster_url,
    ms.name as series_name,
    r.speaker_tags,
    r.mobile_publication_version,
    c.name,
    c.timezone,
    r.mobile_published_at as cursor_published,
    r.id as cursor_id,
    -- The 4:5 tile. Null is a real answer and means "render the wide still in a
    -- wide tile instead", not "render a grey box".
    coalesce(r.artwork_poster_url, ms.artwork_poster_url) as tile_poster_url,
    ms.slug as series_slug
  from public.stream_recordings r
  join public.churches c on c.id = r.church_id
  left join public.media_series ms on ms.id = r.series_id
  left join public.stream_events e on e.id = r.stream_event_id
  where c.slug = p_church_slug
    and p_relationship_state is distinct from 'blocked'
    and r.status = 'ready'
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

revoke all on function public.mobile_media_archive(
  text, text, text, timestamptz, uuid, integer
) from public, anon, authenticated;
grant execute on function public.mobile_media_archive(
  text, text, text, timestamptz, uuid, integer
) to service_role;

notify pgrst, 'reload schema';
