-- Livestream → automatic recording → on-demand publishing
-- Migration 0095 (P15)
--
-- Additive. Extends `stream_recordings` (still the one canonical media row, as
-- 0060 decided), adds the provider-side bookkeeping a segmented recording
-- needs, and replaces the projections whose filters or return shape change.
-- Nothing is dropped except function definitions that are recreated in this
-- same file.
--
-- See docs/faithform/P15_LIVESTREAM_RECORDING_LIFECYCLE.md for the audit that
-- motivated each piece. In one line: recordings used to be a single MP4
-- uploaded after the service ended, which lost its index, hit the storage size
-- limit, and was never linked to the broadcast that produced it. They are now
-- six-second segments uploaded while the service is on air and attributed to
-- the broadcast by time.

-- ---------------------------------------------------------------------------
-- 1. THE RECORDING ROW: LIFECYCLE
-- ---------------------------------------------------------------------------

alter table public.stream_recordings
  -- `file`: one progressive object at storage_path (everything before P15).
  -- `segments`: fMP4 HLS segments indexed in stream_recording_segments.
  add column if not exists source_kind text not null default 'file',
  add column if not exists recording_started_at timestamptz,
  add column if not exists recording_ended_at timestamptz,
  -- When the newest segment was acknowledged. This, not a client flag, is what
  -- the dashboard's "Recording" indicator is derived from.
  add column if not exists last_segment_at timestamptz,
  add column if not exists segment_count integer not null default 0,
  add column if not exists total_bytes bigint not null default 0,
  add column if not exists processing_started_at timestamptz,
  add column if not exists ready_at timestamptz,
  add column if not exists failed_at timestamptz,
  add column if not exists failure_reason text,
  -- For support. Never shown to a church and never to a visitor.
  add column if not exists failure_detail text,
  -- How finalization was reached: every take accounted for, or a timeout.
  add column if not exists finalized_by text,
  -- A frame the relay captured, chosen automatically. Staff can pick another.
  add column if not exists auto_poster_url text,
  -- The church website's media library, alongside the app's mobile_* columns.
  add column if not exists web_published_at timestamptz,
  add column if not exists web_unpublished_at timestamptz,
  -- When publication was confirmed through the production read path.
  add column if not exists publish_confirmed_at timestamptz,
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid references auth.users (id) on delete set null,
  -- When the media behind a deleted recording was removed from storage.
  add column if not exists purged_at timestamptz;

do $$
begin
  alter table public.stream_recordings
    add constraint stream_recordings_source_kind_check
    check (source_kind in ('file', 'segments'));
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.stream_recordings
    add constraint stream_recordings_failure_reason_check
    check (
      failure_reason is null
      or failure_reason in (
        'nothing_recorded',
        'segments_missing',
        'storage_unavailable'
      )
    );
exception
  when duplicate_object then null;
end $$;

do $$
begin
  alter table public.stream_recordings
    add constraint stream_recordings_finalized_by_check
    check (finalized_by is null or finalized_by in ('relay', 'timeout', 'legacy'));
exception
  when duplicate_object then null;
end $$;

-- `recording` and `failed` and `deleted` are new. `published` is the 0034 value
-- nothing has produced since 0060; it stays accepted so no historical row
-- becomes invalid.
alter table public.stream_recordings
  drop constraint if exists stream_recordings_status_check;

alter table public.stream_recordings
  add constraint stream_recordings_status_check
  check (status in ('recording', 'processing', 'ready', 'published', 'failed', 'deleted'));

-- One segmented recording per go-live. The relay and the dashboard can both try
-- to create it; the second insert collides instead of producing a duplicate.
create unique index if not exists stream_recordings_session_segments_idx
  on public.stream_recordings (stream_session_id)
  where source_kind = 'segments' and stream_session_id is not null;

-- The reconciler's work list.
create index if not exists stream_recordings_lifecycle_idx
  on public.stream_recordings (status, updated_at)
  where status in ('recording', 'processing');

create index if not exists stream_recordings_event_idx
  on public.stream_recordings (stream_event_id, created_at desc)
  where stream_event_id is not null;

-- ---------------------------------------------------------------------------
-- 2. TAKES: ONE PER ENCODER CONNECTION
-- ---------------------------------------------------------------------------
--
-- A reconnect is a new take. A recording joins its takes with a
-- discontinuity, so three reconnects are still one service.

create table if not exists public.stream_recording_takes (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  -- Generated by the relay. Unique per church, so a retried "take started" or a
  -- segment that arrives first both land on the same row.
  relay_take_id text not null check (relay_take_id ~ '^[A-Za-z0-9_-]{8,64}$'),
  started_at timestamptz,
  ended_at timestamptz,
  -- The last sequence number, once the relay has closed the take.
  last_seq integer check (last_seq is null or last_seq >= 0),
  -- The furthest the relay has told us about, uploaded or skipped. A segment
  -- starting after a broadcast ended proves every earlier one was reported.
  highest_seen_seq integer,
  highest_seen_start timestamptz,
  init_storage_path text unique,
  init_status text not null default 'none'
    check (init_status in ('none', 'pending_upload', 'uploaded')),
  init_bytes bigint check (init_bytes is null or init_bytes > 0),
  init_uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (church_id, relay_take_id)
);

create index if not exists stream_recording_takes_church_idx
  on public.stream_recording_takes (church_id, started_at desc);

drop trigger if exists stream_recording_takes_updated_at on public.stream_recording_takes;
create trigger stream_recording_takes_updated_at
  before update on public.stream_recording_takes
  for each row execute function public.set_stream_tables_updated_at();

-- ---------------------------------------------------------------------------
-- 3. SEGMENTS: THE RECORDING'S INDEX
-- ---------------------------------------------------------------------------

create table if not exists public.stream_recording_segments (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  recording_id uuid not null references public.stream_recordings (id) on delete cascade,
  take_id uuid not null references public.stream_recording_takes (id) on delete cascade,
  seq integer not null check (seq >= 0),
  started_at timestamptz not null,
  duration_sec numeric(10, 3) not null check (duration_sec > 0 and duration_sec <= 60),
  byte_size bigint check (byte_size is null or byte_size > 0),
  -- Derived by FaithForm from church, recording, take and sequence. Never
  -- supplied by the relay.
  storage_path text not null unique,
  status text not null default 'pending_upload'
    check (status in ('pending_upload', 'uploaded')),
  uploaded_at timestamptz,
  created_at timestamptz not null default now(),
  -- Idempotency: a retried prepare or commit lands on the same row.
  unique (take_id, seq)
);

create index if not exists stream_recording_segments_recording_idx
  on public.stream_recording_segments (recording_id, started_at, seq);

create index if not exists stream_recording_segments_pending_idx
  on public.stream_recording_segments (recording_id)
  where status = 'pending_upload';

-- ---------------------------------------------------------------------------
-- 4. FRAMES: THUMBNAIL CANDIDATES
-- ---------------------------------------------------------------------------

create table if not exists public.stream_recording_frames (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  recording_id uuid not null references public.stream_recordings (id) on delete cascade,
  take_id uuid not null references public.stream_recording_takes (id) on delete cascade,
  seq integer not null check (seq >= 0),
  captured_at timestamptz not null,
  storage_path text not null unique,
  public_url text not null,
  status text not null default 'pending_upload'
    check (status in ('pending_upload', 'uploaded')),
  created_at timestamptz not null default now(),
  unique (take_id, seq)
);

create index if not exists stream_recording_frames_recording_idx
  on public.stream_recording_frames (recording_id, captured_at);

-- ---------------------------------------------------------------------------
-- 5. INGEST STATUS: WHAT THE RELAY LAST SAID
-- ---------------------------------------------------------------------------
--
-- Kept out of the church_integrations metadata blob, which carries the
-- church's RTMP destinations and is written with compare-and-set: a heartbeat
-- every twenty seconds must not contend with Go Live writing destinations.

create table if not exists public.stream_ingest_status (
  church_id uuid primary key references public.churches (id) on delete cascade,
  publishing boolean not null default false,
  relay_take_id text,
  recorder_running boolean not null default false,
  recorder_version text,
  last_segment_closed_at timestamptz,
  pending_uploads integer not null default 0,
  bitrate_kbps integer,
  width integer,
  height integer,
  fps numeric(6, 2),
  video_codec text,
  audio_codec text,
  reconnects integer not null default 0,
  heartbeat_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 6. RELAY WEBHOOK NONCES: REPLAY PROTECTION
-- ---------------------------------------------------------------------------

create table if not exists public.stream_relay_webhook_nonces (
  nonce text primary key check (nonce ~ '^[A-Za-z0-9_-]{16,80}$'),
  route text not null,
  church_id uuid references public.churches (id) on delete cascade,
  received_at timestamptz not null default now()
);

create index if not exists stream_relay_webhook_nonces_received_idx
  on public.stream_relay_webhook_nonces (received_at);

-- ---------------------------------------------------------------------------
-- 7. CHURCH SETTINGS: RECORDING AND PUBLISHING
-- ---------------------------------------------------------------------------

create table if not exists public.stream_recording_settings (
  church_id uuid primary key references public.churches (id) on delete cascade,
  -- Off by default: publishing to a congregation stays a human decision until a
  -- church chooses otherwise.
  auto_publish boolean not null default false,
  default_visibility text not null default 'public'
    check (default_visibility in ('public', 'followers', 'members')),
  default_series_id uuid references public.media_series (id) on delete set null,
  publish_to_website boolean not null default true,
  -- Member notifications. Both off by default so a deploy never starts sending
  -- pushes to a congregation nobody asked to notify.
  notify_on_live boolean not null default false,
  notify_on_publish boolean not null default false,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists stream_recording_settings_updated_at on public.stream_recording_settings;
create trigger stream_recording_settings_updated_at
  before update on public.stream_recording_settings
  for each row execute function public.set_stream_tables_updated_at();

-- ---------------------------------------------------------------------------
-- 8. ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
--
-- Staff read their own church's rows through their own session. Every write
-- goes through the service role, from a route or action that has already
-- authenticated the relay or checked the caller is an admin — so there are no
-- insert, update or delete policies at all, and the table privileges say the
-- same thing.

alter table public.stream_recording_takes enable row level security;
alter table public.stream_recording_segments enable row level security;
alter table public.stream_recording_frames enable row level security;
alter table public.stream_ingest_status enable row level security;
alter table public.stream_relay_webhook_nonces enable row level security;
alter table public.stream_recording_settings enable row level security;

revoke insert, update, delete on table public.stream_recording_takes from anon, authenticated;
revoke insert, update, delete on table public.stream_recording_segments from anon, authenticated;
revoke insert, update, delete on table public.stream_recording_frames from anon, authenticated;
revoke insert, update, delete on table public.stream_ingest_status from anon, authenticated;
revoke all on table public.stream_relay_webhook_nonces from anon, authenticated;
revoke insert, update, delete on table public.stream_recording_settings from anon, authenticated;

drop policy if exists stream_recording_takes_select on public.stream_recording_takes;
create policy stream_recording_takes_select on public.stream_recording_takes
  for select to authenticated
  using (public.is_church_admin(church_id));

drop policy if exists stream_recording_segments_select on public.stream_recording_segments;
create policy stream_recording_segments_select on public.stream_recording_segments
  for select to authenticated
  using (public.is_church_admin(church_id));

drop policy if exists stream_recording_frames_select on public.stream_recording_frames;
create policy stream_recording_frames_select on public.stream_recording_frames
  for select to authenticated
  using (public.is_church_admin(church_id));

drop policy if exists stream_ingest_status_select on public.stream_ingest_status;
create policy stream_ingest_status_select on public.stream_ingest_status
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

drop policy if exists stream_recording_settings_select on public.stream_recording_settings;
create policy stream_recording_settings_select on public.stream_recording_settings
  for select to authenticated
  using (public.is_church_admin(church_id));

-- ---------------------------------------------------------------------------
-- 9. AUDIT AND NOTIFICATIONS: NEW VOCABULARY
-- ---------------------------------------------------------------------------

alter table public.stream_media_publication_audit
  add column if not exists via text not null default 'staff';

do $$
begin
  alter table public.stream_media_publication_audit
    add constraint stream_media_publication_audit_via_check
    check (via in ('staff', 'automatic'));
exception
  when duplicate_object then null;
end $$;

alter table public.stream_media_publication_audit
  drop constraint if exists stream_media_publication_audit_action_check;

alter table public.stream_media_publication_audit
  add constraint stream_media_publication_audit_action_check
  check (action in (
    'published', 'unpublished', 'visibility_changed', 'revoked', 'poster_changed',
    'deleted', 'website_published', 'website_unpublished'
  ));

-- A live service and a newly published recording can notify members. Both are
-- church events, so they ride the existing `events` topic a member can already
-- turn off, rather than a new topic every installed app would have to learn.
alter table public.notification_outbox
  drop constraint if exists notification_outbox_kind_check;

alter table public.notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in (
    'announcement_published', 'event_published', 'service_live', 'recording_published'
  ));

alter table public.notification_outbox
  drop constraint if exists notification_outbox_subject_type_check;

alter table public.notification_outbox
  add constraint notification_outbox_subject_type_check
  check (subject_type in ('announcement', 'stream_event', 'stream_recording'));

-- ---------------------------------------------------------------------------
-- 10. VERSION BUMPS: TRIM, DELETION AND STATUS ARE VISITOR-VISIBLE
-- ---------------------------------------------------------------------------

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

-- ---------------------------------------------------------------------------
-- 11. SEGMENT STATISTICS
-- ---------------------------------------------------------------------------

/*
 * Recomputes a recording's counters from its uploaded segments.
 *
 * An aggregate rather than an increment, so a duplicate or retried commit can
 * never double-count, and calling it twice is the same as calling it once.
 */
create or replace function public.refresh_recording_segment_stats(
  p_recording_id uuid,
  p_church_id uuid
)
returns table (segment_count integer, total_bytes bigint, duration_sec numeric)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  stats record;
begin
  select count(*)::integer as n,
         coalesce(sum(s.byte_size), 0)::bigint as bytes,
         coalesce(sum(s.duration_sec), 0)::numeric as dur,
         min(s.started_at) as first_at,
         max(s.started_at + make_interval(secs => s.duration_sec::double precision)) as last_end,
         max(s.uploaded_at) as last_upload
    into stats
    from public.stream_recording_segments s
   where s.recording_id = p_recording_id
     and s.church_id = p_church_id
     and s.status = 'uploaded';

  update public.stream_recordings as r
     set segment_count = stats.n,
         total_bytes = stats.bytes,
         duration_sec = case when stats.n > 0 then round(stats.dur, 3) else r.duration_sec end,
         recording_started_at = coalesce(least(r.recording_started_at, stats.first_at), stats.first_at),
         recording_ended_at = stats.last_end,
         last_segment_at = coalesce(stats.last_upload, r.last_segment_at)
   where r.id = p_recording_id
     and r.church_id = p_church_id
     and r.source_kind = 'segments';

  return query select stats.n, stats.bytes, round(stats.dur, 3);
end;
$$;

revoke all on function public.refresh_recording_segment_stats(uuid, uuid)
  from public, anon, authenticated;
grant execute on function public.refresh_recording_segment_stats(uuid, uuid)
  to service_role;

-- ---------------------------------------------------------------------------
-- 12. PUBLISHING: ONE IDEMPOTENT, VALIDATED TRANSACTION
-- ---------------------------------------------------------------------------

/*
 * Publishes a recording to the app, the church website, or both — or refuses.
 *
 * Supersedes `publish_recording_to_faithful` for the dashboard (that function
 * stays for anything still calling it). The row is locked for the whole
 * decision, so two staff members, a double click and a retried request all
 * converge on one publication and at most one audit row.
 *
 * Validation is the whole of section 40 of the P15 brief, inside the write:
 * the recording exists in this church, is not deleted, is `ready`, was proved
 * playable against the revision and identity the caller verified, has a
 * title, and has a sane length.
 */
create or replace function public.publish_recording(
  p_recording_id uuid,
  p_church_id uuid,
  p_app_visibility text,
  p_publish_to_web boolean,
  p_poster_url text,
  p_summary text,
  p_expected_revision integer,
  p_expected_object_hash text,
  p_actor_user_id uuid,
  p_via text default 'staff',
  p_now timestamptz default now()
)
returns table (ok boolean, reason text, changed boolean, previous_visibility text)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r record;
  playable_seconds numeric;
  app_changed boolean;
  web_changed boolean;
  meta_changed boolean;
  was_app_live boolean;
  was_web_live boolean;
begin
  if p_app_visibility is not null
     and p_app_visibility not in ('public', 'followers', 'members') then
    return query select false, 'invalid_visibility', false, null::text;
    return;
  end if;
  if p_app_visibility is null and not coalesce(p_publish_to_web, false) then
    return query select false, 'no_destination', false, null::text;
    return;
  end if;
  if p_via not in ('staff', 'automatic') then
    return query select false, 'invalid_request', false, null::text;
    return;
  end if;

  select * into r
    from public.stream_recordings
   where id = p_recording_id and church_id = p_church_id
   for update;

  if not found then
    return query select false, 'not_found', false, null::text;
    return;
  end if;

  if r.deleted_at is not null or r.status = 'deleted' then
    return query select false, 'not_found', false, r.mobile_visibility;
    return;
  end if;
  if r.status <> 'ready' then
    return query select false, 'not_ready', false, r.mobile_visibility;
    return;
  end if;
  if not r.mobile_playable or r.mobile_rendition_verified_at is null then
    return query select false, coalesce(r.mobile_rendition_reason, 'not_verified'), false,
                        r.mobile_visibility;
    return;
  end if;
  if (p_expected_revision is not null and r.mobile_rendition_revision <> p_expected_revision)
     or r.mobile_rendition_object_hash is distinct from p_expected_object_hash then
    return query select false, 'verification_stale', false, r.mobile_visibility;
    return;
  end if;
  if length(btrim(coalesce(r.title, ''))) = 0 then
    return query select false, 'title_missing', false, r.mobile_visibility;
    return;
  end if;

  playable_seconds := case
    when r.trim_end_sec is not null then r.trim_end_sec - r.trim_start_sec
    when r.duration_sec is not null then r.duration_sec - r.trim_start_sec
    else null
  end;
  -- Five seconds to twelve hours. Shorter is a test or a mistake; longer is a
  -- stream someone forgot to end, and a church should trim it first.
  if playable_seconds is null or playable_seconds < 5 or playable_seconds > 12 * 3600 then
    return query select false, 'duration_invalid', false, r.mobile_visibility;
    return;
  end if;

  was_app_live := r.mobile_visibility <> 'none'
    and r.mobile_published_at is not null
    and r.mobile_unpublished_at is null;
  was_web_live := r.web_published_at is not null and r.web_unpublished_at is null;

  app_changed := p_app_visibility is not null
    and (not was_app_live or r.mobile_visibility is distinct from p_app_visibility);
  web_changed := coalesce(p_publish_to_web, false) and not was_web_live;
  meta_changed := (p_app_visibility is not null)
    and (r.mobile_poster_url is distinct from p_poster_url
         or r.mobile_summary is distinct from p_summary);

  if not app_changed and not web_changed and not meta_changed then
    -- Already exactly this. The answer to a repeated click is "done", not a
    -- second publication.
    return query select true, 'unchanged', false, r.mobile_visibility;
    return;
  end if;

  update public.stream_recordings as s
     set mobile_visibility = coalesce(p_app_visibility, s.mobile_visibility),
         mobile_published_at = case
           when app_changed and not was_app_live then p_now
           else s.mobile_published_at
         end,
         mobile_unpublished_at = case when p_app_visibility is not null then null else s.mobile_unpublished_at end,
         mobile_revoked_at = case when p_app_visibility is not null then null else s.mobile_revoked_at end,
         mobile_poster_url = case when p_app_visibility is not null then p_poster_url else s.mobile_poster_url end,
         mobile_summary = case when p_app_visibility is not null then p_summary else s.mobile_summary end,
         web_published_at = case when web_changed then p_now else s.web_published_at end,
         web_unpublished_at = case when web_changed then null else s.web_unpublished_at end
   where s.id = p_recording_id and s.church_id = p_church_id;

  if app_changed then
    insert into public.stream_media_publication_audit
      (church_id, stream_recording_id, action, previous_visibility, new_visibility,
       actor_user_id, via)
    values
      (p_church_id, p_recording_id,
       case when was_app_live then 'visibility_changed' else 'published' end,
       case when was_app_live then r.mobile_visibility else 'none' end,
       p_app_visibility, p_actor_user_id, p_via);
  end if;
  if web_changed then
    insert into public.stream_media_publication_audit
      (church_id, stream_recording_id, action, previous_visibility, new_visibility,
       actor_user_id, via)
    values
      (p_church_id, p_recording_id, 'website_published', null, null, p_actor_user_id, p_via);
  end if;

  return query select true, 'ok', true, r.mobile_visibility;
end;
$$;

revoke all on function public.publish_recording(
  uuid, uuid, text, boolean, text, text, integer, text, uuid, text, timestamptz
) from public, anon, authenticated;
grant execute on function public.publish_recording(
  uuid, uuid, text, boolean, text, text, integer, text, uuid, text, timestamptz
) to service_role;

/*
 * Takes a recording out of the app and the website. Keeps the recording.
 */
create or replace function public.unpublish_recording(
  p_recording_id uuid,
  p_church_id uuid,
  p_actor_user_id uuid,
  p_revoke boolean default false,
  p_now timestamptz default now()
)
returns table (ok boolean, changed boolean)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r record;
  was_app_live boolean;
  was_web_live boolean;
begin
  select * into r
    from public.stream_recordings
   where id = p_recording_id and church_id = p_church_id
   for update;

  if not found then
    return query select false, false;
    return;
  end if;

  was_app_live := r.mobile_visibility <> 'none'
    and r.mobile_published_at is not null
    and r.mobile_unpublished_at is null;
  was_web_live := r.web_published_at is not null and r.web_unpublished_at is null;

  if not was_app_live and not was_web_live
     and not (coalesce(p_revoke, false) and r.mobile_revoked_at is null) then
    return query select true, false;
    return;
  end if;

  update public.stream_recordings as s
     set mobile_unpublished_at = case when was_app_live then p_now else s.mobile_unpublished_at end,
         mobile_revoked_at = case when coalesce(p_revoke, false) then p_now else s.mobile_revoked_at end,
         web_unpublished_at = case when was_web_live then p_now else s.web_unpublished_at end
   where s.id = p_recording_id and s.church_id = p_church_id;

  if was_app_live or coalesce(p_revoke, false) then
    insert into public.stream_media_publication_audit
      (church_id, stream_recording_id, action, previous_visibility, new_visibility, actor_user_id)
    values
      (p_church_id, p_recording_id,
       case when coalesce(p_revoke, false) then 'revoked' else 'unpublished' end,
       r.mobile_visibility, null, p_actor_user_id);
  end if;
  if was_web_live then
    insert into public.stream_media_publication_audit
      (church_id, stream_recording_id, action, previous_visibility, new_visibility, actor_user_id)
    values (p_church_id, p_recording_id, 'website_unpublished', null, null, p_actor_user_id);
  end if;

  return query select true, true;
end;
$$;

revoke all on function public.unpublish_recording(uuid, uuid, uuid, boolean, timestamptz)
  from public, anon, authenticated;
grant execute on function public.unpublish_recording(uuid, uuid, uuid, boolean, timestamptz)
  to service_role;

/*
 * Deletes a recording: withdrawn everywhere at once, marked for purge, and kept
 * as a row so the church's publication history still says it existed.
 *
 * The media itself is removed from storage by the reconciler, which retries
 * until it succeeds and then stamps `purged_at`.
 */
create or replace function public.delete_recording(
  p_recording_id uuid,
  p_church_id uuid,
  p_actor_user_id uuid,
  p_now timestamptz default now()
)
returns table (ok boolean, changed boolean)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  r record;
begin
  select * into r
    from public.stream_recordings
   where id = p_recording_id and church_id = p_church_id
   for update;

  if not found then
    return query select false, false;
    return;
  end if;
  if r.deleted_at is not null then
    return query select true, false;
    return;
  end if;

  update public.stream_recordings as s
     set status = 'deleted',
         deleted_at = p_now,
         deleted_by = p_actor_user_id,
         mobile_playable = false,
         mobile_rendition_kind = null,
         mobile_unpublished_at = coalesce(s.mobile_unpublished_at, p_now),
         mobile_revoked_at = coalesce(s.mobile_revoked_at, p_now),
         web_unpublished_at = case
           when s.web_published_at is not null then coalesce(s.web_unpublished_at, p_now)
           else s.web_unpublished_at
         end
   where s.id = p_recording_id and s.church_id = p_church_id;

  insert into public.stream_media_publication_audit
    (church_id, stream_recording_id, action, previous_visibility, new_visibility, actor_user_id)
  values (p_church_id, p_recording_id, 'deleted', r.mobile_visibility, null, p_actor_user_id);

  return query select true, true;
end;
$$;

revoke all on function public.delete_recording(uuid, uuid, uuid, timestamptz)
  from public, anon, authenticated;
grant execute on function public.delete_recording(uuid, uuid, uuid, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- 13. THE MOBILE PROJECTIONS
-- ---------------------------------------------------------------------------
--
-- Four changes, and only these:
--
--   * `mobile_playable` is restored to the archive and both series projections.
--     0061 added it to the archive; 0080 recreated the archive without it, so
--     since 0080 a published recording later proved unplayable was still
--     *listed* on phones (the grant refused it, so it could not be watched —
--     it was a dead card rather than a leak). Restored here.
--   * A segmented recording's playlist is already trimmed, so it reports a
--     start offset of zero; a progressive file still reports its trim start.
--   * The live card carries the replay's id once the service's recording is
--     published, so "Today's service has ended" can become "Watch the replay".
--   * Deleted recordings are excluded explicitly (they are also unpublished
--     and unplayable, so this is a belt to those braces).

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
    coalesce(r.recording_started_at, r.created_at),
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
    coalesce(r.recording_started_at, r.created_at),
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

revoke all on function public.mobile_media_detail(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.mobile_media_detail(text, text, uuid)
  to service_role;

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
    coalesce(r.recording_started_at, r.created_at),
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
  order by r.mobile_published_at asc, r.id asc;
$$;

revoke all on function public.mobile_media_series_items(text, text, text)
  from public, anon, authenticated;
grant execute on function public.mobile_media_series_items(text, text, text)
  to service_role;

-- The grant keeps its 0062 shape. Only the trim offset for a segmented
-- recording and the explicit deletion filter change.
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
  publication_version integer,
  rendition_kind text,
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
        r.duration_sec,
        case when r.source_kind = 'segments' then 0::numeric else r.trim_start_sec end,
        r.mobile_publication_version,
        r.mobile_rendition_kind,
        r.mobile_rendition_object_etag, r.mobile_rendition_object_version,
        r.mobile_rendition_object_hash, r.mobile_rendition_object_size
      from public.stream_recordings r
      where r.id = p_media_id
        and r.church_id = target_church
        and r.status = 'ready'
        and r.deleted_at is null
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

-- The live card gains `replay_media_id`. Dropped and recreated because the
-- return type grows; the only caller is service-role code deployed with it.
drop function if exists public.mobile_media_live(text, text, timestamptz, integer);

create function public.mobile_media_live(
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
  church_timezone text,
  replay_media_id uuid
)
language sql
security definer
stable
set search_path = public
as $$
  with visible as (
    select
      e.id,
      e.church_id,
      e.title,
      e.starts_at,
      e.countdown_enabled,
      coalesce(e.mobile_poster_url, e.artwork_url) as poster_url,
      e.mobile_publication_version,
      e.status,
      e.updated_at,
      c.name as church_name,
      c.timezone as church_timezone
    from public.stream_events e
    join public.churches c on c.id = e.church_id
    where c.slug = p_church_slug
      and p_relationship_state is distinct from 'blocked'
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
      when v.status = 'live' then 'live'
      when v.status = 'scheduled' and v.starts_at > p_now then 'upcoming'
      else 'recent_ended'
    end as state,
    v.id, v.title, v.starts_at, v.countdown_enabled, v.poster_url,
    v.mobile_publication_version, v.church_name, v.church_timezone,
    -- The same service, watchable again. Every archive filter applies, so the
    -- id is only handed out for something this visitor could open.
    case when v.status = 'ended' then (
      select r.id
        from public.stream_recordings r
       where r.stream_event_id = v.id
         and r.church_id = v.church_id
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
       order by r.mobile_published_at desc
       limit 1
    ) end as replay_media_id
  from visible v
  where v.status = 'live'
     or (v.status = 'scheduled' and v.starts_at > p_now)
     or (v.status = 'ended'
         and v.updated_at > p_now - make_interval(hours => greatest(0, p_ended_window_hours)))
  order by
    case
      when v.status = 'live' then 0
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
-- 14. THE WEBSITE'S READ PATH
-- ---------------------------------------------------------------------------
--
-- Until now the website played any recording by id through a four-hour signed
-- URL, published or not. These two functions are the only way the website
-- reads a recording, and they apply the same eligibility the app does.

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
    coalesce(r.recording_started_at, r.created_at),
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
  order by r.web_published_at desc, r.id desc
  limit greatest(1, least(100, p_limit));
$$;

revoke all on function public.web_recordings(text, uuid, integer)
  from public, anon, authenticated;
grant execute on function public.web_recordings(text, uuid, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- 15. EXISTING ROWS
-- ---------------------------------------------------------------------------
--
-- Every existing recording is a progressive file (the column default). The
-- relay never linked one to its broadcast, because the session it looked up
-- had already ended; link the ones a session's window clearly contains so they
-- pick up their service's title and artwork. Anything ambiguous is left alone
-- rather than guessed.

with candidates as (
  select r.id as recording_id,
         s.id as session_id,
         s.stream_event_id,
         count(*) over (partition by r.id) as matches
    from public.stream_recordings r
    join public.stream_sessions s
      on s.church_id = r.church_id
     and s.created_at <= r.created_at
     -- The relay uploads after the encoder stops, which is shortly after End.
     and coalesce(s.ended_at, s.updated_at) >= r.created_at - interval '30 minutes'
     and coalesce(s.ended_at, s.updated_at) <= r.created_at + interval '5 minutes'
   where r.source_kind = 'file'
     and r.stream_session_id is null
)
update public.stream_recordings r
   set stream_session_id = c.session_id,
       stream_event_id = coalesce(r.stream_event_id, c.stream_event_id),
       title = case
         when coalesce(nullif(r.title, ''), 'Service recording') = 'Service recording'
           then coalesce((select e.title from public.stream_events e where e.id = c.stream_event_id), r.title)
         else r.title
       end,
       finalized_by = coalesce(r.finalized_by, 'legacy')
  from candidates c
 where r.id = c.recording_id
   and c.matches = 1;

update public.stream_recordings
   set finalized_by = 'legacy'
 where source_kind = 'file'
   and finalized_by is null;

notify pgrst, 'reload schema';
