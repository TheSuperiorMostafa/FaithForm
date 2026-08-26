-- Faithful: the mobile-playability gate
-- Migration 0061 (Prompt 9 closure)
--
-- Additive. Columns on one existing table, one trigger extension, one new
-- function, and replacements for four of migration 0060's projections that add
-- a single filter. Migrations 0055-0060 are otherwise untouched.
--
-- ## What was wrong
--
-- Prompt 9 made "published to Faithful" mean "a staff member pressed a button".
-- It did not mean "a phone can play it". Three facts made that a real failure
-- rather than a theoretical one:
--
--   * `sanitizeRecordingFilename` accepts `.mkv`, and `AVPlayer` cannot decode
--     Matroska. A pastor could publish one and every iPhone in the congregation
--     would fail.
--   * The relay uploads with a hard-coded `content-type: video/mp4` regardless
--     of what the file contains, so the stored content type is a claim, not
--     evidence.
--   * Nothing anywhere verified the object after it landed. A truncated upload
--     produced a row that looked identical to a good one.
--
-- ## What replaces it
--
-- `mobile_playable`, written **only** by a server-side probe that reads the
-- object's own bytes and proves its container and codecs
-- (`lib/media/v1/rendition.ts`). It defaults to **false**, so:
--
--   * no existing row is grandfathered — every recording already published is
--     invisible until it has been verified;
--   * a row that has never been probed cannot be published, listed, opened, or
--     granted a playback capability;
--   * a recording whose file later disappears or changes fails its next probe
--     and drops out of every projection.
--
-- The filter is applied in four independent places, so the dashboard is not the
-- only thing standing between a bad file and a congregation.

-- ---------------------------------------------------------------------------
-- ELIGIBILITY COLUMNS
-- ---------------------------------------------------------------------------

-- **The gate.** Default false is the whole design: nothing is playable until
-- something proved it.
alter table public.stream_recordings
  add column if not exists mobile_playable boolean not null default false;

-- How it would be delivered. `hls` is the form this architecture would prefer —
-- the live path already proxies protected HLS, and a VOD playlist would inherit
-- segment-level revocation for free — but **nothing in this repository produces
-- one**. Every recording today is `progressive`. The value exists so the gate
-- does not need rewriting if that changes.
alter table public.stream_recordings
  add column if not exists mobile_rendition_kind text;

-- Why, in machine-readable form. Read by staff-facing copy and by support.
-- Never shown to a visitor: an ineligible recording is simply not in their list.
alter table public.stream_recordings
  add column if not exists mobile_rendition_reason text;

alter table public.stream_recordings
  add column if not exists mobile_rendition_container text;

alter table public.stream_recordings
  add column if not exists mobile_rendition_video_codec text;

alter table public.stream_recordings
  add column if not exists mobile_rendition_audio_codec text;

alter table public.stream_recordings
  add column if not exists mobile_rendition_verified_at timestamptz;

-- The object as it was when it was proved. A different size means a different
-- file, and a different file has not been proved.
alter table public.stream_recordings
  add column if not exists mobile_rendition_object_size bigint;

-- Which verdict this is, counting from zero.
--
-- The optimistic-concurrency token for publishing. It was originally
-- `mobile_rendition_verified_at`, which is wrong for the job: Postgres stores
-- microseconds and a JavaScript `Date` holds milliseconds, so a timestamp read
-- out and passed back never matched and **every publish failed as stale**.
-- Found by running it.
--
-- An integer cannot be lossy in transit, which is the whole requirement.
alter table public.stream_recordings
  add column if not exists mobile_rendition_revision integer not null default 0;

do $$
begin
  alter table public.stream_recordings
    add constraint stream_recordings_mobile_rendition_kind_check
    check (mobile_rendition_kind is null or mobile_rendition_kind in ('hls', 'progressive'));
exception
  when duplicate_object then null;
end $$;

-- A playable row must carry the evidence that made it playable. Without this a
-- direct `update … set mobile_playable = true` would be enough to publish an
-- unverified file.
do $$
begin
  alter table public.stream_recordings
    add constraint stream_recordings_mobile_playable_verified_check
    check (
      not mobile_playable
      or (mobile_rendition_verified_at is not null and mobile_rendition_kind is not null)
    );
exception
  when duplicate_object then null;
end $$;

-- The archive keyset, narrowed to rows that can actually be played. The old
-- index in 0060 stays; this one serves the filter the projections now apply.
create index if not exists stream_recordings_mobile_playable_idx
  on public.stream_recordings (church_id, mobile_published_at desc, id desc)
  where mobile_playable
    and mobile_visibility <> 'none'
    and mobile_unpublished_at is null;

-- ---------------------------------------------------------------------------
-- VERSION INVALIDATION
-- ---------------------------------------------------------------------------

/*
 * A recording becoming unplayable removes it from every list, which is as
 * visitor-visible as any title change. The 0060 trigger did not know about
 * these columns, so this replaces it with one that does.
 *
 * `mobile_rendition_reason` and the codec columns are deliberately **not** in
 * the list: they change when a re-probe records the same verdict with fresh
 * diagnostics, and bumping for that would invalidate every cached list in a
 * congregation for something nobody can see.
 */
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
     -- Prompt 9 closure: appearing and disappearing is visitor-visible.
     or new.mobile_playable is distinct from old.mobile_playable
  then
    new.mobile_publication_version := coalesce(old.mobile_publication_version, 1) + 1;
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- RECORDING A VERDICT
-- ---------------------------------------------------------------------------

/*
 * Writes what the probe proved.
 *
 * The only path that may set `mobile_playable`. It is `security definer` and
 * granted to `service_role` alone, so the verdict cannot be forged from a
 * client — and the check constraint above means even a direct service-role
 * update cannot mark a row playable without also supplying the evidence.
 *
 * **A recording that becomes unplayable is not unpublished here.** The
 * projections filter on `mobile_playable`, so it disappears from every visitor
 * surface immediately, while `mobile_visibility` still records what the church
 * intended — which is what lets it come back on its own once a good file is
 * uploaded, without a pastor having to notice and re-publish.
 */
drop function if exists public.record_recording_rendition(
  uuid, uuid, boolean, text, text, text, text, text, bigint, timestamptz
);

create function public.record_recording_rendition(
  p_recording_id uuid,
  p_church_id uuid,
  p_playable boolean,
  p_kind text,
  p_reason text,
  p_container text default null,
  p_video_codec text default null,
  p_audio_codec text default null,
  p_object_size bigint default null,
  p_now timestamptz default now()
)
returns table (ok boolean, playable boolean, publication_version integer, revision integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  updated record;
begin
  update public.stream_recordings as r
     set mobile_playable = coalesce(p_playable, false),
         mobile_rendition_kind = case when p_playable then p_kind else null end,
         mobile_rendition_reason = p_reason,
         mobile_rendition_container = p_container,
         mobile_rendition_video_codec = p_video_codec,
         mobile_rendition_audio_codec = p_audio_codec,
         mobile_rendition_object_size = p_object_size,
         mobile_rendition_verified_at = p_now,
         mobile_rendition_revision = coalesce(r.mobile_rendition_revision, 0) + 1
   where r.id = p_recording_id
     -- Exact tenant predicate. A recording id from another church matches
     -- nothing rather than being marked playable by a guess.
     and r.church_id = p_church_id
  returning r.* into updated;

  if not found then
    return query select false, false, 0, 0;
    return;
  end if;

  return query select true, updated.mobile_playable, updated.mobile_publication_version,
                      updated.mobile_rendition_revision;
end;
$$;

-- Dropped rather than replaced: the returned row gained `revision`, and
-- `create or replace function` cannot change a return type.
revoke all on function public.record_recording_rendition(
  uuid, uuid, boolean, text, text, text, text, text, bigint, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_recording_rendition(
  uuid, uuid, boolean, text, text, text, text, text, bigint, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- PUBLISHING, TRANSACTIONALLY
-- ---------------------------------------------------------------------------

/*
 * Publishes a recording, or refuses.
 *
 * **The eligibility check is inside the same statement as the write.** There is
 * no read-then-write window in which a verdict could be recorded, invalidated,
 * and published against anyway: the `where` clause carries `mobile_playable`,
 * so a row that stopped being playable between the probe and the publish simply
 * does not match and nothing is written.
 *
 * `p_expected_revision` closes the other half. The caller passes the revision
 * of the verdict it acted on; if a concurrent re-probe has since replaced it,
 * the row no longer matches and the caller is told to try again. Without it,
 * two staff members could publish against two different verdicts and the loser
 * would still win.
 *
 * A revision rather than a timestamp: Postgres stores microseconds and a
 * JavaScript `Date` holds milliseconds, so a timestamp round-tripped through a
 * driver never matched and every publish failed as stale. An integer cannot be
 * lossy in transit.
 */
drop function if exists public.publish_recording_to_faithful(
  uuid, uuid, text, text, text, timestamptz, timestamptz
);

create function public.publish_recording_to_faithful(
  p_recording_id uuid,
  p_church_id uuid,
  p_visibility text,
  p_poster_url text,
  p_summary text,
  p_expected_revision integer,
  p_now timestamptz default now()
)
returns table (ok boolean, reason text, previous_visibility text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  before record;
  updated record;
begin
  if p_visibility not in ('public', 'followers', 'members') then
    return query select false, 'invalid_visibility', null::text;
    return;
  end if;

  select r.mobile_visibility, r.status, r.mobile_playable, r.mobile_rendition_reason,
         r.mobile_rendition_revision
    into before
    from public.stream_recordings r
   where r.id = p_recording_id and r.church_id = p_church_id;

  if not found then
    return query select false, 'not_found', null::text;
    return;
  end if;

  -- Reported separately so the dashboard can say something useful. The write
  -- below would refuse either way; this is only for the message.
  if before.status <> 'ready' then
    return query select false, 'not_ready', before.mobile_visibility;
    return;
  end if;
  if not before.mobile_playable then
    return query select false, coalesce(before.mobile_rendition_reason, 'not_verified'),
                        before.mobile_visibility;
    return;
  end if;

  update public.stream_recordings as r
     set mobile_visibility = p_visibility,
         mobile_published_at = p_now,
         mobile_unpublished_at = null,
         mobile_revoked_at = null,
         mobile_poster_url = p_poster_url,
         mobile_summary = p_summary
   where r.id = p_recording_id
     and r.church_id = p_church_id
     -- **The gate, in the write itself.**
     and r.status = 'ready'
     and r.mobile_playable
     and r.mobile_rendition_verified_at is not null
     and (
       p_expected_revision is null
       or r.mobile_rendition_revision = p_expected_revision
     )
  returning r.* into updated;

  if not found then
    -- Something moved between the read and the write. Re-verify and retry
    -- rather than publishing against a verdict that no longer holds.
    return query select false, 'verification_stale', before.mobile_visibility;
    return;
  end if;

  return query select true, 'ok', before.mobile_visibility;
end;
$$;

revoke all on function public.publish_recording_to_faithful(
  uuid, uuid, text, text, text, integer, timestamptz
) from public, anon, authenticated;
grant execute on function public.publish_recording_to_faithful(
  uuid, uuid, text, text, text, integer, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- THE PROJECTIONS, NARROWED
-- ---------------------------------------------------------------------------
--
-- Each of these is migration 0060's function with **one filter added**:
--
--     and r.mobile_playable
--
-- Replaced rather than wrapped so there is exactly one definition of what a
-- visitor can see. A wrapper would leave the permissive version callable, and
-- something would eventually call it.
--
-- This is what makes the gate independent of the dashboard: a row already
-- published before this migration, or one marked visible by a direct database
-- write, is filtered here regardless of how it got that way.

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
    -- **Prompt 9 closure.** Proven playable on both platforms, or invisible.
    -- Search runs after this, so an unplayable recording's title cannot
    -- surface through the search box either.
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

revoke all on function public.mobile_media_archive(
  text, text, text, timestamptz, uuid, integer
) from public, anon, authenticated;
grant execute on function public.mobile_media_archive(
  text, text, text, timestamptz, uuid, integer
) to service_role;

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
    -- A device holding a list cached from before a recording became unplayable
    -- must not be able to open it by id.
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

revoke all on function public.mobile_media_detail(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.mobile_media_detail(text, text, uuid)
  to service_role;

/*
 * The playback grant, narrowed.
 *
 * **The independent one.** A stale cached list, a replayed request, or a device
 * that held on to an id from before a re-probe all arrive here, and this is
 * where they are refused — regardless of what the dashboard allowed, what the
 * list once contained, or what a client believes.
 *
 * Live events are unaffected: an event has no stored file to verify, and its
 * eligibility is the session check that was already there.
 */
-- Dropped rather than replaced: `create or replace function` cannot change a
-- function's return type, and this adds `rendition_kind` to the row. The drop
-- and the create are in one migration, so the function is never missing outside
-- this transaction.
drop function if exists public.mobile_media_playback_grant(
  text, text, text, uuid, timestamptz
);

create function public.mobile_media_playback_grant(
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
  publication_version integer,
  -- How the bytes will arrive, so the delivery route and the player agree
  -- without either inferring it from a path.
  rendition_kind text
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

  if target_church is null or p_relationship_state = 'blocked' then
    return query select false, 'not_found', null::uuid, null::text, null::uuid,
                        null::numeric, null::numeric, 0, null::text;
    return;
  end if;

  if p_kind = 'live' then
    return query
      select
        true, 'ok', e.church_id, null::text, e.church_id,
        null::numeric, null::numeric, e.mobile_publication_version, 'hls'::text
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
        r.duration_sec, r.trim_start_sec, r.mobile_publication_version,
        r.mobile_rendition_kind
      from public.stream_recordings r
      where r.id = p_media_id
        and r.church_id = target_church
        and r.status = 'ready'
        -- **Independent of everything upstream.**
        and r.mobile_playable
        and r.mobile_rendition_verified_at is not null
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
                        null::numeric, null::numeric, 0, null::text;
  end if;
end;
$$;

revoke all on function public.mobile_media_playback_grant(
  text, text, text, uuid, timestamptz
) from public, anon, authenticated;
grant execute on function public.mobile_media_playback_grant(
  text, text, text, uuid, timestamptz
) to service_role;

notify pgrst, 'reload schema';
