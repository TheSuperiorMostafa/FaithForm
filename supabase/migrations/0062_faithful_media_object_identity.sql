-- Faithful: codec configuration and object identity
-- Migration 0062 (Prompt 9 eligibility hardening)
--
-- Additive. Columns on one existing table, one new function, and replacements
-- for three of migration 0061's functions whose signatures grew. Migrations
-- 0055-0061 are otherwise untouched.
--
-- ## What was still wrong after 0061
--
-- 0061 proved the container brand and the sample-entry fourccs, and called that
-- "mobile playable". Two gaps survived, and both are the kind that reach a
-- congregation rather than a test bench.
--
-- ### A fourcc is not a codec
--
-- `avc1` is the same four bytes whether the stream is Baseline 3.0, which every
-- phone decodes, or High 4:4:4 Predictive 10-bit at Level 6.2, which neither
-- platform's hardware path will touch. `mp4a` is the same four bytes whether the
-- payload is AAC-LC or MP3-in-MP4. 0061 accepted all of them equally.
--
-- The parser now reads the decoder configuration itself -- `avcC` for video,
-- `esds` for audio -- and checks it against a written policy
-- (`lib/media/v1/portable-profile.ts`) derived from the platform targets this
-- app actually declares: iOS 17 and Android API 26.
--
-- ### A storage path is mutable
--
-- `infra/stream-relay/upload-recording.sh` uploads with `x-upsert: true`. So
-- re-running it replaces the object *at an unchanged path*, and a verdict
-- recorded against a path said nothing about what was at that path afterwards.
-- A church could publish a verified recording and then overwrite it with
-- anything at all.
--
-- Every verdict now carries the identity of the exact bytes it was taken from --
-- a strong ETag, a version id, the content length, and a SHA-256 over the
-- inspected window -- and that identity is re-checked before publication, before
-- a capability is issued, and on every delivery request.
--
-- ## Existing rows are re-verified, not carried over
--
-- Every `mobile_playable` is set back to false below, before the constraint that
-- requires identity evidence is added. A verdict taken without an identity is
-- not evidence about the object that is there now, and 0061's own argument
-- applies to 0061's own rows: nothing is playable until something proved it.
--
-- As in 0061, `mobile_visibility` is **not** cleared. The church's intent
-- survives; only its eligibility is withdrawn, so a recording that re-verifies
-- returns on its own.

-- ---------------------------------------------------------------------------
-- CODEC CONFIGURATION
-- ---------------------------------------------------------------------------

-- RFC 6381 codec strings -- `avc1.4d401f`, `mp4a.40.2`. Stored in the form both
-- platforms' documentation, `MediaCodec` and every bug report use, because a
-- support conversation that starts with `avc1.640034` is shorter than one that
-- starts with "High".
alter table public.stream_recordings
  add column if not exists mobile_rendition_video_profile text;

alter table public.stream_recordings
  add column if not exists mobile_rendition_audio_profile text;

-- Not in the RFC 6381 audio string, and the two settings a church's encoder is
-- most likely to have wrong.
alter table public.stream_recordings
  add column if not exists mobile_rendition_audio_sample_rate integer;

alter table public.stream_recordings
  add column if not exists mobile_rendition_audio_channels smallint;

-- ---------------------------------------------------------------------------
-- OBJECT IDENTITY
-- ---------------------------------------------------------------------------

-- A **strong** entity tag. Weak validators (`W/"..."`) are discarded by the
-- probe rather than stored: a weak tag promises semantic equivalence, which is
-- not the question being asked, and accepting one would mean accepting exactly
-- the substitution this mechanism exists to detect.
alter table public.stream_recordings
  add column if not exists mobile_rendition_object_etag text;

-- Where the provider exposes object versioning.
alter table public.stream_recordings
  add column if not exists mobile_rendition_object_version text;

-- SHA-256 over the exact bytes the parser inspected. The part of the identity
-- that never depends on the provider: computed from data already read, costing
-- nothing extra, and provable even if storage returns no validator at all.
--
-- It covers the inspected window rather than the whole object, because hashing a
-- three-hour service would mean transferring it. A change confined to the middle
-- of a file, outside both windows, is caught by the content length instead.
alter table public.stream_recordings
  add column if not exists mobile_rendition_object_hash text;

-- ---------------------------------------------------------------------------
-- NOTHING IS CARRIED OVER
-- ---------------------------------------------------------------------------

-- Withdraws every verdict taken before identities existed. Intent is untouched.
update public.stream_recordings
   set mobile_playable = false,
       mobile_rendition_kind = null,
       mobile_rendition_reason = 'object_identity_unavailable'
 where mobile_playable;

-- **The flag cannot exist without something to bind it to.** With this in place
-- a direct `update ... set mobile_playable = true` fails, exactly as 0061's
-- verification constraint made an unverified one fail.
--
-- Two clauses, because the identity is checked in two very different places:
--
--   * the **hash** is required outright. It is computed from bytes already read,
--     so it is always available, and it is what publication compares.
--   * at least one of **ETag, version id or length** is required as well, and
--     this half is not decoration. A capability issuance and a delivery request
--     cannot re-hash a window — that would mean transferring it on every range
--     request — so they compare only what a response advertises. Without one of
--     these three there would be nothing for them to compare, and a check with
--     nothing to compare is not a check.
alter table public.stream_recordings
  drop constraint if exists stream_recordings_mobile_playable_identity_check;

alter table public.stream_recordings
  add constraint stream_recordings_mobile_playable_identity_check
  check (
    not mobile_playable
    or (
      mobile_rendition_object_hash is not null
      and (
        mobile_rendition_object_etag is not null
        or mobile_rendition_object_version is not null
        or mobile_rendition_object_size is not null
      )
    )
  );

-- ---------------------------------------------------------------------------
-- RECORDING A VERDICT
-- ---------------------------------------------------------------------------

-- Dropped rather than replaced: the parameter list grew, and `create or replace
-- function` cannot change a signature. The drop and the create are in one
-- migration, so the function is never missing outside this transaction.
drop function if exists public.record_recording_rendition(
  uuid, uuid, boolean, text, text, text, text, text, bigint, timestamptz
);

/*
 * Writes what a probe proved, and the identity of the bytes that proved it.
 *
 * The only thing in the system permitted to set `mobile_playable`. Every call
 * increments `mobile_rendition_revision`, which is what a publish is checked
 * against -- see `publish_recording_to_faithful`.
 */
create function public.record_recording_rendition(
  p_recording_id uuid,
  p_church_id uuid,
  p_playable boolean,
  p_kind text,
  p_reason text,
  p_container text default null,
  p_video_codec text default null,
  p_audio_codec text default null,
  p_video_profile text default null,
  p_audio_profile text default null,
  p_audio_sample_rate integer default null,
  p_audio_channels smallint default null,
  p_object_size bigint default null,
  p_object_etag text default null,
  p_object_version text default null,
  p_object_hash text default null,
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
  identified boolean;
begin
  -- Defence in depth against the constraint above: a caller that reports a
  -- playable rendition with no identity is refused here with a reason rather
  -- than raising, so a probe bug degrades to "unverified" rather than to a 500.
  identified := p_object_hash is not null
            and (
              p_object_etag is not null
              or p_object_version is not null
              or p_object_size is not null
            );

  update public.stream_recordings as r
     set mobile_playable = coalesce(p_playable, false) and identified,
         mobile_rendition_kind = case
           when coalesce(p_playable, false) and identified then p_kind else null
         end,
         mobile_rendition_reason = case
           when coalesce(p_playable, false) and not identified
             then 'object_identity_unavailable'
           else p_reason
         end,
         mobile_rendition_container = p_container,
         mobile_rendition_video_codec = p_video_codec,
         mobile_rendition_audio_codec = p_audio_codec,
         mobile_rendition_video_profile = p_video_profile,
         mobile_rendition_audio_profile = p_audio_profile,
         mobile_rendition_audio_sample_rate = p_audio_sample_rate,
         mobile_rendition_audio_channels = p_audio_channels,
         mobile_rendition_object_size = p_object_size,
         mobile_rendition_object_etag = p_object_etag,
         mobile_rendition_object_version = p_object_version,
         mobile_rendition_object_hash = p_object_hash,
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

revoke all on function public.record_recording_rendition(
  uuid, uuid, boolean, text, text, text, text, text, text, text, integer, smallint,
  bigint, text, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.record_recording_rendition(
  uuid, uuid, boolean, text, text, text, text, text, text, text, integer, smallint,
  bigint, text, text, text, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- WITHDRAWING A VERDICT
-- ---------------------------------------------------------------------------

/*
 * Marks a recording unverified, without touching what the church intended.
 *
 * Called when the object at a verified path is found to have changed. Separate
 * from `record_recording_rendition` because it is not a probe result: nothing
 * was read, and the honest state is "we no longer know", not "we know it is
 * bad".
 *
 * Clearing `mobile_playable` moves `mobile_publication_version` through the
 * existing trigger, so every cached list and every stored ETag is invalidated in
 * the same statement. A device holding yesterday's archive cannot open the item
 * afterwards -- the detail projection and the grant refuse it independently.
 */
create function public.invalidate_recording_rendition(
  p_recording_id uuid,
  p_church_id uuid,
  p_reason text default 'object_changed',
  p_now timestamptz default now()
)
returns table (ok boolean, publication_version integer, revision integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  updated record;
begin
  update public.stream_recordings as r
     set mobile_playable = false,
         mobile_rendition_kind = null,
         mobile_rendition_reason = p_reason,
         mobile_rendition_verified_at = p_now,
         mobile_rendition_revision = coalesce(r.mobile_rendition_revision, 0) + 1
   where r.id = p_recording_id
     and r.church_id = p_church_id
  returning r.* into updated;

  if not found then
    return query select false, 0, 0;
    return;
  end if;

  return query select true, updated.mobile_publication_version,
                      updated.mobile_rendition_revision;
end;
$$;

revoke all on function public.invalidate_recording_rendition(uuid, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.invalidate_recording_rendition(uuid, uuid, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- PUBLISHING, BOUND TO AN IDENTITY
-- ---------------------------------------------------------------------------

-- Dropped rather than replaced: the parameter list grew by the expected object
-- identity.
drop function if exists public.publish_recording_to_faithful(
  uuid, uuid, text, text, text, integer, timestamptz
);

/*
 * Publishes a recording, or refuses.
 *
 * **The eligibility check is inside the same statement as the write.** There is
 * no read-then-write window in which a verdict could be recorded, invalidated,
 * and published against anyway: the `where` clause carries `mobile_playable`,
 * so a row that stopped being playable between the probe and the publish simply
 * does not match and nothing is written.
 *
 * `p_expected_revision` closes the concurrency half. The caller passes the
 * revision of the verdict it acted on; if a concurrent re-probe has since
 * replaced it, the row no longer matches and the caller is told to try again.
 *
 * A revision rather than a timestamp: Postgres stores microseconds and a
 * JavaScript `Date` holds milliseconds, so a timestamp round-tripped through a
 * driver never matched and every publish failed as stale. An integer cannot be
 * lossy in transit.
 *
 * `p_expected_object_hash` and `p_expected_object_etag` close the *identity*
 * half, and are not redundant with the revision. The revision proves nothing new
 * was written to the row; the identity proves the row still describes the object
 * that is in the bucket. A caller that re-probed and then published is checked
 * against both, so a publish can never be bound to bytes nobody looked at.
 */
create function public.publish_recording_to_faithful(
  p_recording_id uuid,
  p_church_id uuid,
  p_visibility text,
  p_poster_url text,
  p_summary text,
  p_expected_revision integer,
  p_expected_object_hash text default null,
  p_expected_object_etag text default null,
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
     -- **The identity, in the write itself.** A null expectation is not a
     -- wildcard for a row that has a value: only a row that also has none
     -- matches, so a caller cannot opt out of the binding by omitting it.
     and r.mobile_rendition_object_hash is not distinct from p_expected_object_hash
     and (
       p_expected_object_etag is null
       or r.mobile_rendition_object_etag is not distinct from p_expected_object_etag
     )
  returning r.* into updated;

  if not found then
    -- Something moved between the read and the write. Re-verify and retry
    -- rather than publishing against a verdict that no longer holds.
    return query select false, 'verification_stale', before.mobile_visibility;
    return;
  end if;

  -- The audit row is written by the caller, which knows the actor and whether
  -- this was a first publication or a visibility change. Writing one here as
  -- well would double every entry in a church's history.
  return query select true, 'ok', before.mobile_visibility;
end;
$$;

revoke all on function public.publish_recording_to_faithful(
  uuid, uuid, text, text, text, integer, text, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.publish_recording_to_faithful(
  uuid, uuid, text, text, text, integer, text, text, timestamptz
) to service_role;

-- ---------------------------------------------------------------------------
-- THE GRANT CARRIES THE IDENTITY
-- ---------------------------------------------------------------------------

-- Dropped rather than replaced: the returned row gained the object identity, and
-- `create or replace function` cannot change a return type.
drop function if exists public.mobile_media_playback_grant(
  text, text, text, uuid, timestamptz
);

/*
 * Whether this caller may play this item, and -- for a recording -- which object
 * they are entitled to.
 *
 * The identity travels with the grant so the capability issuer and the delivery
 * route can both prove the bytes they are about to serve are the bytes that were
 * verified, without either of them re-reading the row or, worse, trusting the
 * path.
 */
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
  rendition_kind text,
  -- Which bytes. Compared against the object before anything is served.
  object_etag text,
  object_version text,
  object_hash text,
  object_size bigint
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
                        null::numeric, null::numeric, 0, null::text,
                        null::text, null::text, null::text, null::bigint;
    return;
  end if;

  if p_kind = 'live' then
    return query
      select
        true, 'ok', e.church_id, null::text, e.church_id,
        null::numeric, null::numeric, e.mobile_publication_version, 'hls'::text,
        null::text, null::text, null::text, null::bigint
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
        r.mobile_rendition_kind,
        r.mobile_rendition_object_etag, r.mobile_rendition_object_version,
        r.mobile_rendition_object_hash, r.mobile_rendition_object_size
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
                        null::numeric, null::numeric, 0, null::text,
                        null::text, null::text, null::text, null::bigint;
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
