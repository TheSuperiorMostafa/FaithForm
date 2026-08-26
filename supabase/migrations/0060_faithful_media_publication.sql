-- Faithful: pastor-published livestreams and recording history
-- Migration 0060 (Prompt 9)
--
-- Additive. Columns on two existing tables, one new audit table, two triggers
-- and five projection functions. Nothing existing is altered or dropped, and
-- migrations 0055-0059 are untouched.
--
-- ## Why there is no new media table
--
-- `stream_events` and `stream_recordings` are already the authority for what a
-- church broadcast and what it recorded. A separate `faithful_media` table
-- would be a second one — with its own idea of when a stream ended, its own
-- copy of a title someone edits on the dashboard, and its own opportunity to
-- disagree.
--
-- Migration 0054 already established the alternative for announcements:
-- additive `mobile_*` columns on the authoritative row, a version bumped only
-- by fields a device renders, and a `security definer` projection function that
-- filters structurally. This is that pattern, applied to media.
--
-- ## The single most important line in this file
--
--     mobile_visibility text not null default 'none'
--
-- Applying this migration **publishes nothing**. Every existing event and every
-- existing recording — including the ones already sitting in the media library —
-- stays invisible to every phone until a staff member explicitly publishes it.
-- A recording must not appear in Faithful merely because it exists.

-- ---------------------------------------------------------------------------
-- LIVE EVENTS
-- ---------------------------------------------------------------------------

alter table public.stream_events
  add column if not exists mobile_visibility text not null default 'none';

alter table public.stream_events
  add column if not exists mobile_published_at timestamptz;

alter table public.stream_events
  add column if not exists mobile_unpublished_at timestamptz;

-- A stronger unpublish. Unpublishing hides an item; revoking additionally
-- refuses to issue any further playback capability, which is what stops a
-- device that already has a list from acquiring a fresh one.
alter table public.stream_events
  add column if not exists mobile_revoked_at timestamptz;

alter table public.stream_events
  add column if not exists mobile_publication_version integer not null default 1;

-- Chosen from the church's own existing assets and validated in the
-- application before it is written. No uploader, no external URL.
alter table public.stream_events
  add column if not exists mobile_poster_url text;

do $$
begin
  alter table public.stream_events
    add constraint stream_events_mobile_visibility_check
    check (mobile_visibility in ('none', 'public', 'followers', 'members'));
exception
  when duplicate_object then null;
end $$;

-- The live projection's exact filter. Partial, because almost no event is ever
-- mobile-visible and those rows should not sit in this index.
create index if not exists stream_events_mobile_live_idx
  on public.stream_events (church_id, status, starts_at desc)
  where mobile_visibility <> 'none' and mobile_unpublished_at is null;

-- ---------------------------------------------------------------------------
-- RECORDINGS
-- ---------------------------------------------------------------------------

alter table public.stream_recordings
  add column if not exists mobile_visibility text not null default 'none';

alter table public.stream_recordings
  add column if not exists mobile_published_at timestamptz;

alter table public.stream_recordings
  add column if not exists mobile_unpublished_at timestamptz;

alter table public.stream_recordings
  add column if not exists mobile_revoked_at timestamptz;

alter table public.stream_recordings
  add column if not exists mobile_publication_version integer not null default 1;

alter table public.stream_recordings
  add column if not exists mobile_poster_url text;

-- What a church wants a visitor to see, which is not always the internal title
-- the relay generated ("Service recording"). Null falls back to `title`.
alter table public.stream_recordings
  add column if not exists mobile_summary text;

do $$
begin
  alter table public.stream_recordings
    add constraint stream_recordings_mobile_visibility_check
    check (mobile_visibility in ('none', 'public', 'followers', 'members'));
exception
  when duplicate_object then null;
end $$;

-- The archive's exact keyset: published desc, id desc.
create index if not exists stream_recordings_mobile_archive_idx
  on public.stream_recordings (church_id, mobile_published_at desc, id desc)
  where mobile_visibility <> 'none' and mobile_unpublished_at is null;

-- ---------------------------------------------------------------------------
-- SELECTIVE VERSION INVALIDATION
-- ---------------------------------------------------------------------------
--
-- The version is what an ETag folds in, so bumping it invalidates every cached
-- list on every device for that church. Bumping on *every* column would mean a
-- syndication retry timestamp, an encoder handshake, or a trim value nobody can
-- see costing a congregation a full refetch.
--
-- So each trigger names exactly the fields a phone renders. Everything else —
-- and there is a lot of it on these two tables — moves silently.

create or replace function public.bump_stream_event_mobile_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.title is distinct from old.title
     or new.starts_at is distinct from old.starts_at
     or new.status is distinct from old.status
     or new.artwork_url is distinct from old.artwork_url
     or new.mobile_poster_url is distinct from old.mobile_poster_url
     or new.mobile_visibility is distinct from old.mobile_visibility
     or new.mobile_unpublished_at is distinct from old.mobile_unpublished_at
     or new.mobile_revoked_at is distinct from old.mobile_revoked_at
     or new.countdown_enabled is distinct from old.countdown_enabled
  then
    new.mobile_publication_version := coalesce(old.mobile_publication_version, 1) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists stream_events_bump_mobile_version on public.stream_events;
create trigger stream_events_bump_mobile_version
  before update on public.stream_events
  for each row execute function public.bump_stream_event_mobile_version();

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

drop trigger if exists stream_recordings_bump_mobile_version on public.stream_recordings;
create trigger stream_recordings_bump_mobile_version
  before update on public.stream_recordings
  for each row execute function public.bump_stream_recording_mobile_version();

-- ---------------------------------------------------------------------------
-- AUDIT
-- ---------------------------------------------------------------------------
--
-- Who published, unpublished, changed visibility or revoked access, and when.
-- Append-only: a correction is another row, never an edit, because "it was
-- published for three hours on Sunday" is a question a church may need to
-- answer long after someone unpublished it.

create table if not exists public.stream_media_publication_audit (
  id uuid primary key default gen_random_uuid(),

  church_id uuid not null references public.churches (id) on delete cascade,
  -- Exactly one of these is set. Deliberately two nullable columns rather than
  -- a polymorphic id, so a foreign key still holds on both sides.
  stream_event_id uuid references public.stream_events (id) on delete cascade,
  stream_recording_id uuid references public.stream_recordings (id) on delete cascade,

  action text not null
    check (action in ('published', 'unpublished', 'visibility_changed', 'revoked', 'poster_changed')),

  previous_visibility text,
  new_visibility text,

  actor_user_id uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint stream_media_publication_audit_target
    check (num_nonnulls(stream_event_id, stream_recording_id) = 1)
);

create index if not exists stream_media_publication_audit_church_idx
  on public.stream_media_publication_audit (church_id, created_at desc);

create index if not exists stream_media_publication_audit_event_idx
  on public.stream_media_publication_audit (stream_event_id, created_at desc);

create index if not exists stream_media_publication_audit_recording_idx
  on public.stream_media_publication_audit (stream_recording_id, created_at desc);

alter table public.stream_media_publication_audit enable row level security;

-- Staff read their own church's history through the dashboard's own session.
-- Writes go through the service role from a server action that has already
-- checked the actor is an admin, so there is no insert policy at all.
drop policy if exists stream_media_publication_audit_select
  on public.stream_media_publication_audit;
create policy stream_media_publication_audit_select
  on public.stream_media_publication_audit
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

-- ---------------------------------------------------------------------------
-- THE LIVE PROJECTION
-- ---------------------------------------------------------------------------

/*
 * What a church is showing right now, if anything.
 *
 * Returns at most one row, and often none — which is the point. A home screen
 * must not carry an empty "Live" area on a Tuesday, so "nothing published" is
 * expressed as no row rather than as a row with a falsy flag.
 *
 * The three states it can report:
 *
 *   live          an event marked live, with a session that actually has an
 *                 encoder attached. An event someone forgot to end does not
 *                 keep claiming to be live, because the session check is what
 *                 the public status page already relies on.
 *   upcoming      a published, scheduled event whose start is still ahead.
 *   recent_ended  a published event that finished within the last day. This is
 *                 what lets the app say "today's service has ended — the
 *                 recording will appear when it's ready" instead of the card
 *                 vanishing mid-Sunday and looking broken.
 *
 * `security definer` because it reads `stream_sessions`, which visitors have no
 * business selecting from directly.
 */
create or replace function public.mobile_media_live(
  p_church_slug text,
  p_relationship_state text,
  p_now timestamptz default now(),
  p_ended_window_hours integer default 24
)
returns table (
  state text,
  event_id uuid,
  title text,
  starts_at timestamptz,
  countdown_enabled boolean,
  poster_url text,
  publication_version integer,
  church_name text,
  church_timezone text
)
language sql
security definer
stable
set search_path = public
as $$
  with visible as (
    select
      e.id,
      e.title,
      e.starts_at,
      e.countdown_enabled,
      coalesce(e.mobile_poster_url, e.artwork_url) as poster_url,
      e.mobile_publication_version,
      e.status,
      e.updated_at,
      c.name as church_name,
      c.timezone as church_timezone,
      exists (
        select 1
          from public.stream_sessions s
         where s.church_id = e.church_id
           and s.stream_event_id = e.id
           and s.status in ('preparing', 'waiting_for_encoder', 'live')
           and s.ingest_started_at is not null
      ) as has_ingest
    from public.stream_events e
    join public.churches c on c.id = e.church_id
    where c.slug = p_church_slug
      -- A blocked visitor sees nothing at all, not even public items, exactly
      -- as the announcement feed decided in Prompt 5.
      and p_relationship_state is distinct from 'blocked'
      -- Draft and cancelled are excluded structurally.
      and e.mobile_visibility <> 'none'
      and e.mobile_unpublished_at is null
      and e.status <> 'cancelled'
      and (
        e.mobile_visibility = 'public'
        or (e.mobile_visibility = 'followers'
            and p_relationship_state in ('following', 'joined'))
        or (e.mobile_visibility = 'members'
            and p_relationship_state = 'joined')
      )
  )
  select
    case
      when v.status = 'live' and v.has_ingest then 'live'
      when v.status = 'scheduled' and v.starts_at > p_now then 'upcoming'
      else 'recent_ended'
    end as state,
    v.id, v.title, v.starts_at, v.countdown_enabled, v.poster_url,
    v.mobile_publication_version, v.church_name, v.church_timezone
  from visible v
  where (v.status = 'live' and v.has_ingest)
     or (v.status = 'scheduled' and v.starts_at > p_now)
     or (v.status = 'ended'
         and v.updated_at > p_now - make_interval(hours => greatest(0, p_ended_window_hours)))
  -- Live wins over upcoming, and upcoming over recently-ended. A church with a
  -- service running and another scheduled must show the one on air.
  order by
    case
      when v.status = 'live' and v.has_ingest then 0
      when v.status = 'scheduled' then 1
      else 2
    end,
    v.starts_at asc
  limit 1;
$$;

revoke all on function public.mobile_media_live(text, text, timestamptz, integer)
  from public, anon, authenticated;
grant execute on function public.mobile_media_live(text, text, timestamptz, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- THE ARCHIVE
-- ---------------------------------------------------------------------------

/*
 * Published recordings, newest first, keyset-paginated.
 *
 * Five filters do the work, and every one of them is structural rather than a
 * rule a caller has to remember:
 *
 *   status = 'ready'            a processing recording has no playable file
 *   mobile_visibility <> 'none' nobody published it
 *   mobile_published_at is not null   belt to the same braces
 *   mobile_unpublished_at is null     someone took it down
 *   relationship targeting            it was published to a narrower audience
 *
 * `p_query` searches the title, the visitor-facing summary, the speaker tags
 * and the series name. It searches *after* those filters, so a private
 * recording's title can never surface through a search box — which is the way
 * unpublished metadata usually leaks.
 */
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
  cursor_id uuid
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
    -- The trimmed length is what a visitor will actually watch.
    case
      when r.trim_end_sec is not null then greatest(0, r.trim_end_sec - r.trim_start_sec)
      when r.duration_sec is not null then greatest(0, r.duration_sec - r.trim_start_sec)
      else null
    end as duration_sec,
    coalesce(r.mobile_poster_url, e.mobile_poster_url, e.artwork_url) as poster_url,
    ms.name as series_name,
    r.speaker_tags,
    r.mobile_publication_version,
    c.name,
    c.timezone,
    r.mobile_published_at as cursor_published,
    r.id as cursor_id
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

-- ---------------------------------------------------------------------------
-- DETAIL
-- ---------------------------------------------------------------------------

/*
 * One published recording.
 *
 * Every filter from the archive applies again rather than being assumed from
 * the fact that a list once contained this id. A device holding a list cached
 * from before an unpublish must not be able to open the detail page by id.
 */
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
    r.created_at,
    case
      when r.trim_end_sec is not null then greatest(0, r.trim_end_sec - r.trim_start_sec)
      when r.duration_sec is not null then greatest(0, r.duration_sec - r.trim_start_sec)
      else null
    end,
    r.trim_start_sec,
    coalesce(r.mobile_poster_url, e.mobile_poster_url, e.artwork_url),
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

revoke all on function public.mobile_media_detail(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.mobile_media_detail(text, text, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- THE PLAYBACK GRANT
-- ---------------------------------------------------------------------------

/*
 * May this caller be issued a playback capability, and for what?
 *
 * Deliberately separate from the projections, and deliberately stricter:
 *
 *   * it re-checks **`mobile_revoked_at`**, which the list projections do not
 *     need to because a revoked item is also unpublished — but a device that
 *     already holds a capability must be refused a *refresh* the instant a
 *     church revokes, and this is the function that refuses it;
 *   * it returns the storage path for a recording, so the delivery route never
 *     has to trust a client-supplied path;
 *   * for a live item it re-checks the session, so a capability cannot be
 *     minted for an event whose encoder has gone.
 *
 * The storage path never leaves the server. It is returned to a service-role
 * caller which uses it to open a byte stream, and the projection functions
 * above deliberately do not return it at all.
 */
create or replace function public.mobile_media_playback_grant(
  p_church_slug text,
  p_relationship_state text,
  p_kind text,
  p_media_id uuid,
  p_now timestamptz default now()
)
returns table (
  ok boolean,
  reason text,
  church_id uuid,
  storage_path text,
  stream_path_church_id uuid,
  duration_sec numeric,
  trim_start_sec numeric,
  publication_version integer
)
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  target_church uuid;
begin
  select c.id into target_church
    from public.churches c
   where c.slug = p_church_slug;

  -- A hidden church, an unknown slug and a blocked visitor are one answer.
  -- Distinguishing them would turn this into a church-existence oracle.
  if target_church is null or p_relationship_state = 'blocked' then
    return query select false, 'not_found', null::uuid, null::text, null::uuid,
                        null::numeric, null::numeric, 0;
    return;
  end if;

  if p_kind = 'live' then
    return query
      select
        true, 'ok', e.church_id, null::text, e.church_id,
        null::numeric, null::numeric, e.mobile_publication_version
      from public.stream_events e
      where e.id = p_media_id
        and e.church_id = target_church
        and e.status = 'live'
        and e.mobile_visibility <> 'none'
        and e.mobile_unpublished_at is null
        and e.mobile_revoked_at is null
        and (
          e.mobile_visibility = 'public'
          or (e.mobile_visibility = 'followers'
              and p_relationship_state in ('following', 'joined'))
          or (e.mobile_visibility = 'members'
              and p_relationship_state = 'joined')
        )
        and exists (
          select 1 from public.stream_sessions s
           where s.church_id = e.church_id
             and s.stream_event_id = e.id
             and s.status in ('preparing', 'waiting_for_encoder', 'live')
             and s.ingest_started_at is not null
        );
  else
    return query
      select
        true, 'ok', r.church_id, r.storage_path, r.church_id,
        r.duration_sec, r.trim_start_sec, r.mobile_publication_version
      from public.stream_recordings r
      where r.id = p_media_id
        and r.church_id = target_church
        and r.status = 'ready'
        and r.mobile_visibility <> 'none'
        and r.mobile_published_at is not null
        and r.mobile_unpublished_at is null
        and r.mobile_revoked_at is null
        and (
          r.mobile_visibility = 'public'
          or (r.mobile_visibility = 'followers'
              and p_relationship_state in ('following', 'joined'))
          or (r.mobile_visibility = 'members'
              and p_relationship_state = 'joined')
        );
  end if;

  if not found then
    return query select false, 'not_found', null::uuid, null::text, null::uuid,
                        null::numeric, null::numeric, 0;
  end if;
end;
$$;

revoke all on function public.mobile_media_playback_grant(
  text, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.mobile_media_playback_grant(
  text, text, text, uuid, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- THE ARCHIVE'S VERSION
-- ---------------------------------------------------------------------------

/*
 * The highest visitor-visible version across a church's published media.
 *
 * Folded into the list ETag so that publishing, unpublishing or editing any one
 * item invalidates the list — while provider bookkeeping, which the triggers
 * above deliberately ignore, does not.
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
  select coalesce(max(v), 0)::integer from (
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
  ) versions;
$$;

revoke all on function public.mobile_media_version(text, text)
  from public, anon, authenticated;
grant execute on function public.mobile_media_version(text, text)
  to service_role;

notify pgrst, 'reload schema';
