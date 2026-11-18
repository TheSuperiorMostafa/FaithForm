-- Migration 0167
--
-- Sermon media: transcripts of saved recordings, the staff-confirmed sermon
-- range, recording-sourced lessons, clip drafts, their renders, and Facebook
-- Reel posts.
--
-- Additive only. No existing table, policy or grant changes. Every table here is
-- server-owned: RLS on, nothing granted to browsers, service_role only. Staff
-- reads and writes go through routes that check church membership, role and
-- feature access before using the admin client (P8 privacy model).
--
-- Rollout is opt-in per church: no row in sermon_media_settings, or
-- enabled = false, means nothing is queued and the dashboard hides the feature.
--
-- Timeline: every time stored here is seconds on the recording's own untrimmed
-- playback timeline — seconds from its first segment with reconnect gaps
-- removed, exactly what `full.m3u8` plays (recording-model.ts). A file
-- recording's timeline is the file's own.

-- ---------------------------------------------------------------------------
-- Rollout
-- ---------------------------------------------------------------------------

create table if not exists public.sermon_media_settings (
  church_id uuid primary key references public.churches (id) on delete cascade,
  enabled boolean not null default false,
  auto_transcribe boolean not null default true,
  -- 'auto' lets the engine detect; otherwise an ISO 639-1 hint.
  language text not null default 'auto'
    constraint sermon_media_settings_language check (language ~ '^(auto|[a-z]{2})$'),
  -- At most this many of the church's jobs run at once.
  max_concurrent_jobs integer not null default 2
    constraint sermon_media_settings_concurrency check (max_concurrent_jobs between 1 and 10),
  updated_by uuid,
  updated_at timestamptz not null default now()
);
alter table public.sermon_media_settings enable row level security;
revoke all on table public.sermon_media_settings from public, anon, authenticated;
grant select, insert, update, delete on table public.sermon_media_settings to service_role;

-- ---------------------------------------------------------------------------
-- Jobs
--
-- One table for GPU transcription and CPU clip rendering. A job is dispatched
-- to the worker under a lease. Assume duplicate deliveries and overlapping
-- attempts: the first worker to begin an attempt binds its attempt id, every
-- later write must present lease token + attempt id, and an expired lease is
-- reclaimed by the dispatcher, which issues a new token — so a stale worker can
-- never write a result over a newer one.
-- ---------------------------------------------------------------------------

create table if not exists public.media_jobs (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  recording_id uuid not null references public.stream_recordings (id) on delete cascade,
  kind text not null
    constraint media_jobs_kind check (kind in ('transcribe', 'render_clip')),
  -- Transcribe: the recording. Render: the sermon_clip_renders row.
  subject_id uuid not null,
  dedupe_key text not null
    constraint media_jobs_dedupe_length check (length(dedupe_key) between 1 and 200),
  -- Identifiers and settings only. Never a token, a URL or transcript text.
  params jsonb not null default '{}'::jsonb
    constraint media_jobs_params_size check (octet_length(params::text) <= 4096),
  source text not null default 'auto'
    constraint media_jobs_source check (source in ('auto', 'manual', 'retry')),
  requested_by uuid,
  status text not null default 'queued'
    constraint media_jobs_status check (status in ('queued', 'dispatched', 'running', 'succeeded', 'failed', 'cancelled')),
  stage text
    constraint media_jobs_stage check (stage is null or stage ~ '^[a-z_]{1,40}$'),
  progress real
    constraint media_jobs_progress check (progress is null or (progress >= 0 and progress <= 1)),
  attempts integer not null default 0,
  max_attempts integer not null default 3
    constraint media_jobs_max_attempts check (max_attempts between 1 and 10),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_id uuid,
  dispatch_ref text
    constraint media_jobs_dispatch_ref check (dispatch_ref is null or length(dispatch_ref) <= 120),
  cancel_requested_at timestamptz,
  last_error_code text
    constraint media_jobs_error_code check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,60}$'),
  last_error text
    constraint media_jobs_error_length check (last_error is null or length(last_error) <= 300),
  -- Stage durations, audio seconds, worker seconds, engine. Numbers and names.
  metrics jsonb not null default '{}'::jsonb
    constraint media_jobs_metrics_size check (octet_length(metrics::text) <= 8192),
  created_at timestamptz not null default now(),
  dispatched_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  updated_at timestamptz not null default now(),
  constraint media_jobs_lease_pair check ((lease_token is null) = (lease_expires_at is null))
);
alter table public.media_jobs enable row level security;
revoke all on table public.media_jobs from public, anon, authenticated;
grant select, insert, update, delete on table public.media_jobs to service_role;

-- One live job per subject and kind: a repeated enqueue returns it.
create unique index if not exists media_jobs_active_dedupe
  on public.media_jobs (dedupe_key)
  where status in ('queued', 'dispatched', 'running');
create index if not exists media_jobs_due
  on public.media_jobs (next_attempt_at)
  where status in ('queued', 'dispatched', 'running');
create index if not exists media_jobs_recording
  on public.media_jobs (recording_id, created_at desc);
create index if not exists media_jobs_church_active
  on public.media_jobs (church_id)
  where status in ('dispatched', 'running');

-- Enqueue atomically. Returns the live job for this dedupe key, new or not.
create or replace function public.enqueue_media_job(
  p_church_id uuid,
  p_recording_id uuid,
  p_kind text,
  p_subject_id uuid,
  p_dedupe_key text,
  p_params jsonb default '{}'::jsonb,
  p_source text default 'auto',
  p_requested_by uuid default null,
  p_max_attempts integer default 3
)
returns public.media_jobs
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_job public.media_jobs;
begin
  -- The recording must belong to the church and still exist.
  if not exists (
    select 1 from public.stream_recordings r
     where r.id = p_recording_id and r.church_id = p_church_id and r.deleted_at is null
  ) then
    raise exception 'recording not found' using errcode = 'P0002';
  end if;

  insert into public.media_jobs (
    church_id, recording_id, kind, subject_id, dedupe_key, params, source, requested_by, max_attempts
  ) values (
    p_church_id, p_recording_id, p_kind, p_subject_id, p_dedupe_key,
    coalesce(p_params, '{}'::jsonb), coalesce(p_source, 'auto'), p_requested_by,
    greatest(1, least(coalesce(p_max_attempts, 3), 10))
  )
  on conflict (dedupe_key) where status in ('queued', 'dispatched', 'running')
  do nothing
  returning * into v_job;

  if v_job.id is null then
    select * into v_job from public.media_jobs
     where dedupe_key = p_dedupe_key and status in ('queued', 'dispatched', 'running')
     limit 1;
  end if;
  return v_job;
end;
$$;

-- Claim due jobs for dispatch, within the global and per-church caps.
--
-- Serialized with a transaction advisory lock so two dispatcher runs cannot
-- each see room under the cap and overshoot it. A job whose lease expired is
-- reclaimed: retried with a new lease token if attempts remain, otherwise
-- failed. A cancelled-while-queued job is closed here.
create or replace function public.claim_media_jobs(
  p_kind text,
  p_global_cap integer,
  p_limit integer default 10,
  p_lease_seconds integer default 900,
  p_now timestamptz default now()
)
returns setof public.media_jobs
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_room integer;
begin
  perform pg_advisory_xact_lock(hashtext('media_jobs_claim:' || p_kind));

  -- Expired leases with no attempts left fail; the rest become due again.
  update public.media_jobs j
     set status = case when j.attempts >= j.max_attempts then 'failed' else 'queued' end,
         last_error_code = coalesce(j.last_error_code, 'lease_expired'),
         last_error = coalesce(j.last_error, 'The worker stopped responding.'),
         finished_at = case when j.attempts >= j.max_attempts then p_now else null end,
         lease_token = null, lease_expires_at = null, attempt_id = null,
         next_attempt_at = p_now + make_interval(secs => least(600, 30 * power(2, j.attempts)::integer)),
         updated_at = p_now
   where j.kind = p_kind
     and j.status in ('dispatched', 'running')
     and j.lease_expires_at <= p_now;

  update public.media_jobs j
     set status = 'cancelled', finished_at = p_now, updated_at = p_now
   where j.kind = p_kind and j.status = 'queued' and j.cancel_requested_at is not null;

  select greatest(0, p_global_cap - count(*))::integer into v_room
    from public.media_jobs
   where kind = p_kind and status in ('dispatched', 'running');
  if v_room = 0 then
    return;
  end if;

  return query
  with church_load as (
    select church_id, count(*)::integer as active
      from public.media_jobs
     where status in ('dispatched', 'running')
     group by church_id
  ),
  ranked as (
    select j.id, j.church_id,
           row_number() over (partition by j.church_id order by j.next_attempt_at, j.created_at) as nth,
           coalesce(s.max_concurrent_jobs, 2) - coalesce(l.active, 0) as church_room,
           j.next_attempt_at, j.created_at
      from public.media_jobs j
      left join public.sermon_media_settings s on s.church_id = j.church_id
      left join church_load l on l.church_id = j.church_id
     where j.kind = p_kind and j.status = 'queued' and j.next_attempt_at <= p_now
  ),
  chosen as (
    select r.id from ranked r
     where r.nth <= r.church_room
     order by r.next_attempt_at, r.created_at
     limit least(v_room, greatest(1, least(coalesce(p_limit, 10), 100)))
  ),
  locked as (
    select j.id from public.media_jobs j join chosen c on c.id = j.id
     for update of j skip locked
  )
  update public.media_jobs j
     set status = 'dispatched',
         lease_token = gen_random_uuid(),
         lease_expires_at = p_now + make_interval(secs => greatest(60, p_lease_seconds)),
         attempt_id = null,
         attempts = j.attempts + 1,
         dispatched_at = p_now,
         stage = 'waiting_for_worker',
         progress = 0,
         updated_at = p_now
    from locked
   where j.id = locked.id
  returning j.*;
end;
$$;

-- The dispatcher records the provider call reference, or gives the lease back
-- when the hand-off failed (so the job is due again without waiting for expiry).
create or replace function public.mark_media_job_dispatch(
  p_job_id uuid,
  p_lease_token uuid,
  p_dispatch_ref text,
  p_error text default null
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  if p_error is null then
    update public.media_jobs
       set dispatch_ref = left(p_dispatch_ref, 120), updated_at = now()
     where id = p_job_id and lease_token = p_lease_token and status in ('dispatched', 'running');
  else
    update public.media_jobs
       set status = case when attempts >= max_attempts then 'failed' else 'queued' end,
           finished_at = case when attempts >= max_attempts then now() else null end,
           lease_token = null, lease_expires_at = null, attempt_id = null,
           last_error_code = 'dispatch_failed', last_error = left(p_error, 300),
           next_attempt_at = now() + interval '60 seconds',
           updated_at = now()
     where id = p_job_id and lease_token = p_lease_token and status = 'dispatched';
  end if;
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- A worker begins (or continues) an attempt. The first attempt id to arrive
-- under a lease wins; a duplicate delivery with another attempt id is refused.
-- Returns 'ok', 'cancelled' or 'stale'.
create or replace function public.touch_media_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_attempt_id uuid,
  p_stage text default null,
  p_progress real default null,
  p_extend_seconds integer default 300
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_job public.media_jobs;
begin
  select * into v_job from public.media_jobs where id = p_job_id for update;
  if v_job.id is null
     or v_job.lease_token is distinct from p_lease_token
     or v_job.status not in ('dispatched', 'running')
     or v_job.lease_expires_at <= now()
     or (v_job.attempt_id is not null and v_job.attempt_id <> p_attempt_id) then
    return 'stale';
  end if;
  if v_job.cancel_requested_at is not null then
    update public.media_jobs
       set status = 'cancelled', finished_at = now(), lease_token = null, lease_expires_at = null,
           updated_at = now()
     where id = p_job_id;
    return 'cancelled';
  end if;
  update public.media_jobs
     set status = 'running',
         attempt_id = p_attempt_id,
         started_at = coalesce(started_at, now()),
         stage = coalesce(p_stage, stage),
         progress = coalesce(p_progress, progress),
         lease_expires_at = greatest(lease_expires_at, now() + make_interval(secs => least(greatest(p_extend_seconds, 60), 1800))),
         updated_at = now()
   where id = p_job_id;
  return 'ok';
end;
$$;

-- Close an attempt as failed. Retryable failures go back to the queue with
-- backoff while attempts remain.
create or replace function public.fail_media_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_attempt_id uuid,
  p_error_code text,
  p_error text,
  p_retryable boolean,
  p_metrics jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  update public.media_jobs
     set status = case when p_retryable and attempts < max_attempts then 'queued' else 'failed' end,
         finished_at = case when p_retryable and attempts < max_attempts then null else now() end,
         next_attempt_at = now() + make_interval(secs => least(1800, 60 * power(2, attempts)::integer)),
         lease_token = null, lease_expires_at = null, attempt_id = null,
         last_error_code = p_error_code, last_error = left(p_error, 300),
         metrics = metrics || coalesce(p_metrics, '{}'::jsonb),
         updated_at = now()
   where id = p_job_id and lease_token = p_lease_token
     and attempt_id = p_attempt_id and status = 'running';
  get diagnostics v_count = row_count;
  return v_count = 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Per-recording state: transcript pointer, suggested and confirmed range, and
-- the input version that downstream drafts are built from.
-- ---------------------------------------------------------------------------

create table if not exists public.recording_sermon_media (
  recording_id uuid primary key references public.stream_recordings (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  current_transcript_version integer,
  suggestion_status text not null default 'none'
    constraint recording_sermon_media_suggestion_status check (suggestion_status in ('none', 'suggested', 'uncertain', 'failed')),
  suggested_start_sec numeric(10, 3),
  suggested_end_sec numeric(10, 3),
  suggestion_confidence real
    constraint recording_sermon_media_confidence check (suggestion_confidence is null or (suggestion_confidence >= 0 and suggestion_confidence <= 1)),
  suggestion_evidence jsonb not null default '[]'::jsonb
    constraint recording_sermon_media_evidence check (jsonb_typeof(suggestion_evidence) = 'array' and octet_length(suggestion_evidence::text) <= 16384),
  suggested_for_version integer,
  confirmed_start_sec numeric(10, 3),
  confirmed_end_sec numeric(10, 3),
  confirmed_by uuid,
  confirmed_at timestamptz,
  confirmed_transcript_version integer,
  -- Bumped whenever the confirmed range moves or a transcript edit touches it.
  -- Lessons and clips record the input version they were built from.
  input_version integer not null default 0,
  updated_at timestamptz not null default now(),
  constraint recording_sermon_media_suggested_order check (
    suggested_start_sec is null or suggested_end_sec is null or suggested_start_sec < suggested_end_sec),
  constraint recording_sermon_media_confirmed_order check (
    (confirmed_start_sec is null) = (confirmed_end_sec is null)
    and (confirmed_start_sec is null or (confirmed_start_sec >= 0 and confirmed_start_sec < confirmed_end_sec)))
);
alter table public.recording_sermon_media enable row level security;
revoke all on table public.recording_sermon_media from public, anon, authenticated;
grant select, insert, update, delete on table public.recording_sermon_media to service_role;
create index if not exists recording_sermon_media_church on public.recording_sermon_media (church_id);

-- ---------------------------------------------------------------------------
-- Transcript versions. Version 1.. are immutable once written. A machine
-- version keeps the engine's original timing; an edited version keeps each
-- segment's machine start/end and id, replaces its text, and drops word timing
-- only for segments whose text changed.
-- ---------------------------------------------------------------------------

create table if not exists public.recording_transcripts (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  recording_id uuid not null references public.stream_recordings (id) on delete cascade,
  version integer not null constraint recording_transcripts_version check (version >= 1),
  kind text not null constraint recording_transcripts_kind check (kind in ('machine', 'edited')),
  based_on_version integer,
  job_id uuid references public.media_jobs (id) on delete set null,
  language text constraint recording_transcripts_language check (language is null or language ~ '^[a-z]{2,3}(-[A-Za-z]{2})?$'),
  engine text constraint recording_transcripts_engine check (engine is null or length(engine) <= 80),
  duration_sec numeric(10, 3),
  -- [{id, start, end, text, words?: [{w, s, e, p?}], conf?, flags?: [...]}]
  segments jsonb not null
    constraint recording_transcripts_segments check (jsonb_typeof(segments) = 'array' and octet_length(segments::text) <= 12582912),
  -- [{start, end, reason: 'missing_audio' | 'discontinuity' | 'silence' | 'music' | 'noise'}]
  gaps jsonb not null default '[]'::jsonb
    constraint recording_transcripts_gaps check (jsonb_typeof(gaps) = 'array' and octet_length(gaps::text) <= 1048576),
  -- Time-windowed audio events: [{start, end, label, score}]
  audio_events jsonb not null default '[]'::jsonb
    constraint recording_transcripts_events check (jsonb_typeof(audio_events) = 'array' and octet_length(audio_events::text) <= 1048576),
  edit_note text constraint recording_transcripts_note check (edit_note is null or length(edit_note) <= 300),
  created_by uuid,
  created_at timestamptz not null default now(),
  constraint recording_transcripts_version_unique unique (recording_id, version)
);
alter table public.recording_transcripts enable row level security;
revoke all on table public.recording_transcripts from public, anon, authenticated;
grant select, insert, delete on table public.recording_transcripts to service_role;
create index if not exists recording_transcripts_church on public.recording_transcripts (church_id, created_at desc);

-- Commit a machine transcript under a live lease and attempt, atomically with
-- the job's success. A stale or duplicate worker gets false and writes nothing.
create or replace function public.commit_machine_transcript(
  p_job_id uuid,
  p_lease_token uuid,
  p_attempt_id uuid,
  p_language text,
  p_engine text,
  p_duration_sec numeric,
  p_segments jsonb,
  p_gaps jsonb,
  p_audio_events jsonb,
  p_metrics jsonb
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_job public.media_jobs;
  v_version integer;
begin
  select * into v_job from public.media_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.kind <> 'transcribe'
     or v_job.lease_token is distinct from p_lease_token
     or v_job.attempt_id is distinct from p_attempt_id
     or v_job.status <> 'running' or v_job.lease_expires_at <= now() then
    return null;
  end if;

  insert into public.recording_sermon_media (recording_id, church_id)
  values (v_job.recording_id, v_job.church_id)
  on conflict (recording_id) do nothing;
  perform 1 from public.recording_sermon_media where recording_id = v_job.recording_id for update;

  select coalesce(max(version), 0) + 1 into v_version
    from public.recording_transcripts where recording_id = v_job.recording_id;

  insert into public.recording_transcripts (
    church_id, recording_id, version, kind, job_id, language, engine, duration_sec,
    segments, gaps, audio_events
  ) values (
    v_job.church_id, v_job.recording_id, v_version, 'machine', v_job.id, p_language, p_engine,
    p_duration_sec, p_segments, coalesce(p_gaps, '[]'::jsonb), coalesce(p_audio_events, '[]'::jsonb)
  );

  -- A fresh machine transcript after a confirmed range is new input: drafts
  -- built on the old words need review. Before confirmation nothing depends on it.
  update public.recording_sermon_media
     set current_transcript_version = v_version,
         input_version = case when confirmed_start_sec is not null then input_version + 1 else input_version end,
         updated_at = now()
   where recording_id = v_job.recording_id;

  update public.media_jobs
     set status = 'succeeded', stage = 'done', progress = 1, finished_at = now(),
         lease_token = null, lease_expires_at = null,
         metrics = metrics || coalesce(p_metrics, '{}'::jsonb), last_error_code = null, last_error = null,
         updated_at = now()
   where id = p_job_id;

  perform public.flag_sermon_media_drafts(v_job.recording_id, 'The transcript was replaced.');
  return v_version;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lessons built from a recording. The lesson itself stays in public.sermons;
-- this links it to its source and records the evidence.
-- ---------------------------------------------------------------------------

create table if not exists public.sermon_recording_sources (
  sermon_id uuid primary key references public.sermons (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  recording_id uuid not null references public.stream_recordings (id) on delete cascade,
  input_version integer not null,
  transcript_version integer not null,
  range_start_sec numeric(10, 3) not null,
  range_end_sec numeric(10, 3) not null,
  -- {sections: {intro: [segId..], points: [[segId..]..], ...}, quotes: [...], scripture: [...]}
  evidence jsonb not null default '{}'::jsonb
    constraint sermon_recording_sources_evidence check (octet_length(evidence::text) <= 262144),
  generated_by uuid,
  generated_at timestamptz not null default now(),
  -- sermons.updated_at right after generation; a later value means staff edited it.
  generated_sermon_updated_at timestamptz,
  needs_review boolean not null default false,
  review_reason text constraint sermon_recording_sources_reason check (review_reason is null or length(review_reason) <= 200)
);
alter table public.sermon_recording_sources enable row level security;
revoke all on table public.sermon_recording_sources from public, anon, authenticated;
grant select, insert, update, delete on table public.sermon_recording_sources to service_role;
create index if not exists sermon_recording_sources_recording on public.sermon_recording_sources (recording_id);

-- ---------------------------------------------------------------------------
-- Clips, renders and Facebook Reel posts
-- ---------------------------------------------------------------------------

create table if not exists public.sermon_clips (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  recording_id uuid not null references public.stream_recordings (id) on delete cascade,
  input_version integer not null,
  origin text not null constraint sermon_clips_origin check (origin in ('suggested', 'manual')),
  status text not null default 'suggested'
    constraint sermon_clips_status check (status in ('suggested', 'draft', 'archived')),
  rank integer,
  start_sec numeric(10, 3) not null,
  end_sec numeric(10, 3) not null,
  excerpt text not null default '' constraint sermon_clips_excerpt check (length(excerpt) <= 4000),
  reason text not null default '' constraint sermon_clips_reason check (length(reason) <= 400),
  signals jsonb not null default '{}'::jsonb constraint sermon_clips_signals check (octet_length(signals::text) <= 8192),
  -- {mode: 'speaker' | 'wide_fit' | 'manual', x: 0..1}
  framing jsonb not null default '{"mode":"wide_fit"}'::jsonb
    constraint sermon_clips_framing check (octet_length(framing::text) <= 4096),
  -- [{start, end, text}] relative to start_sec. Null: build from the transcript.
  captions jsonb constraint sermon_clips_captions check (captions is null or (jsonb_typeof(captions) = 'array' and octet_length(captions::text) <= 65536)),
  captions_enabled boolean not null default true,
  facebook_caption text not null default '' constraint sermon_clips_fb_caption check (length(facebook_caption) <= 2200),
  -- Bumped by every edit that changes the rendered result.
  edit_version integer not null default 1,
  needs_review boolean not null default false,
  review_reason text constraint sermon_clips_review_reason check (review_reason is null or length(review_reason) <= 200),
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sermon_clips_order check (start_sec >= 0 and end_sec > start_sec)
);
alter table public.sermon_clips enable row level security;
revoke all on table public.sermon_clips from public, anon, authenticated;
grant select, insert, update, delete on table public.sermon_clips to service_role;
create index if not exists sermon_clips_recording on public.sermon_clips (recording_id, status, rank);

create table if not exists public.sermon_clip_renders (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  clip_id uuid not null references public.sermon_clips (id) on delete cascade,
  edit_version integer not null,
  -- sha256 of the render spec (range, framing, captions). Approval binds to it.
  spec_hash text not null constraint sermon_clip_renders_hash check (spec_hash ~ '^[a-f0-9]{64}$'),
  spec jsonb not null constraint sermon_clip_renders_spec check (octet_length(spec::text) <= 131072),
  status text not null default 'queued'
    constraint sermon_clip_renders_status check (status in ('queued', 'rendering', 'ready', 'failed', 'superseded')),
  storage_path text constraint sermon_clip_renders_path check (storage_path is null or storage_path ~ '^clips/[0-9a-f-]{36}/[0-9a-f-]{36}/[0-9a-f-]{36}\.mp4$'),
  byte_size bigint,
  sha256 text constraint sermon_clip_renders_sha check (sha256 is null or sha256 ~ '^[a-f0-9]{64}$'),
  -- ffprobe facts and the spec check verdict.
  media jsonb not null default '{}'::jsonb constraint sermon_clip_renders_media check (octet_length(media::text) <= 16384),
  validation jsonb not null default '{}'::jsonb constraint sermon_clip_renders_validation check (octet_length(validation::text) <= 16384),
  failure_reason text constraint sermon_clip_renders_failure check (failure_reason is null or length(failure_reason) <= 300),
  approved_by uuid,
  approved_at timestamptz,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint sermon_clip_renders_unique unique (clip_id, edit_version)
);
alter table public.sermon_clip_renders enable row level security;
revoke all on table public.sermon_clip_renders from public, anon, authenticated;
grant select, insert, update, delete on table public.sermon_clip_renders to service_role;
create index if not exists sermon_clip_renders_clip on public.sermon_clip_renders (clip_id, created_at desc);

-- Commit a finished render under a live lease and attempt.
create or replace function public.commit_clip_render(
  p_job_id uuid,
  p_lease_token uuid,
  p_attempt_id uuid,
  p_storage_path text,
  p_byte_size bigint,
  p_sha256 text,
  p_media jsonb,
  p_validation jsonb,
  p_ok boolean,
  p_metrics jsonb
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_job public.media_jobs;
begin
  select * into v_job from public.media_jobs where id = p_job_id for update;
  if v_job.id is null or v_job.kind <> 'render_clip'
     or v_job.lease_token is distinct from p_lease_token
     or v_job.attempt_id is distinct from p_attempt_id
     or v_job.status <> 'running' or v_job.lease_expires_at <= now() then
    return false;
  end if;

  update public.sermon_clip_renders
     set status = case when p_ok then 'ready' else 'failed' end,
         storage_path = p_storage_path, byte_size = p_byte_size, sha256 = p_sha256,
         media = coalesce(p_media, '{}'::jsonb), validation = coalesce(p_validation, '{}'::jsonb),
         failure_reason = case when p_ok then null else 'The finished video did not meet Facebook''s Reel requirements.' end,
         updated_at = now()
   where id = v_job.subject_id and status in ('queued', 'rendering');

  update public.media_jobs
     set status = 'succeeded', stage = 'done', progress = 1, finished_at = now(),
         lease_token = null, lease_expires_at = null,
         metrics = metrics || coalesce(p_metrics, '{}'::jsonb), updated_at = now()
   where id = p_job_id;
  return true;
end;
$$;

create table if not exists public.facebook_reel_posts (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  clip_id uuid not null references public.sermon_clips (id) on delete cascade,
  render_id uuid not null references public.sermon_clip_renders (id) on delete cascade,
  page_id text not null constraint facebook_reel_posts_page check (page_id ~ '^[0-9]{1,40}$'),
  page_name text constraint facebook_reel_posts_page_name check (page_name is null or length(page_name) <= 200),
  caption text not null default '' constraint facebook_reel_posts_caption check (length(caption) <= 2200),
  status text not null default 'starting'
    constraint facebook_reel_posts_status check (status in (
      'starting', 'uploading', 'finishing', 'processing', 'posted', 'failed', 'needs_check')),
  provider_video_id text constraint facebook_reel_posts_video check (provider_video_id is null or provider_video_id ~ '^[0-9]{1,40}$'),
  provider_post_id text constraint facebook_reel_posts_post check (provider_post_id is null or length(provider_post_id) <= 80),
  permalink text constraint facebook_reel_posts_permalink check (permalink is null or permalink ~ '^https://(www\.|m\.)?facebook\.com/'),
  approved_by uuid not null,
  approved_at timestamptz not null,
  posted_by uuid not null,
  -- Serializes the publish steps for one post across requests and cron.
  step_lock_until timestamptz,
  last_error_code text constraint facebook_reel_posts_error_code check (last_error_code is null or last_error_code ~ '^[a-z0-9_]{1,60}$'),
  last_error text constraint facebook_reel_posts_error check (last_error is null or length(last_error) <= 300),
  check_attempts integer not null default 0,
  -- Finish is sent once per video; one re-finish is allowed only after Meta
  -- reports the upload complete but publishing never started.
  finish_attempts integer not null default 0,
  finish_requested_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  posted_at timestamptz,
  last_checked_at timestamptz
);
alter table public.facebook_reel_posts enable row level security;
revoke all on table public.facebook_reel_posts from public, anon, authenticated;
grant select, insert, update, delete on table public.facebook_reel_posts to service_role;
-- A render goes to a Page at most once unless the earlier attempt definitively
-- failed. A double-click or retried request lands on the existing row.
create unique index if not exists facebook_reel_posts_once
  on public.facebook_reel_posts (render_id, page_id)
  where status <> 'failed';
create index if not exists facebook_reel_posts_open
  on public.facebook_reel_posts (updated_at)
  where status in ('starting', 'uploading', 'finishing', 'processing', 'needs_check');
create index if not exists facebook_reel_posts_clip on public.facebook_reel_posts (clip_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Input versioning
-- ---------------------------------------------------------------------------

-- Mark lessons and clips built from an older input as needing review. Posted
-- Reels and published lessons keep what they published; only the draft flag
-- changes, and a sermon's saved content is never touched here.
create or replace function public.flag_sermon_media_drafts(
  p_recording_id uuid,
  p_reason text
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_input integer;
begin
  select input_version into v_input from public.recording_sermon_media where recording_id = p_recording_id;
  if v_input is null then
    return;
  end if;
  update public.sermon_recording_sources
     set needs_review = true, review_reason = left(p_reason, 200)
   where recording_id = p_recording_id and input_version < v_input and not needs_review;
  update public.sermon_clips
     set needs_review = true, review_reason = left(p_reason, 200), updated_at = now()
   where recording_id = p_recording_id and input_version < v_input
     and status <> 'archived' and not needs_review;
end;
$$;

-- Confirm (or move) the sermon range. Optimistic: the caller passes the input
-- version it saw, so two staff confirming at once cannot silently overwrite.
-- Returns the new input version, or null when the caller's view was stale.
create or replace function public.confirm_sermon_range(
  p_recording_id uuid,
  p_church_id uuid,
  p_start_sec numeric,
  p_end_sec numeric,
  p_user_id uuid,
  p_expected_input_version integer
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.recording_sermon_media;
  v_changed boolean;
begin
  insert into public.recording_sermon_media (recording_id, church_id)
  select r.id, r.church_id from public.stream_recordings r
   where r.id = p_recording_id and r.church_id = p_church_id and r.deleted_at is null
  on conflict (recording_id) do nothing;

  select * into v_row from public.recording_sermon_media
   where recording_id = p_recording_id and church_id = p_church_id for update;
  if v_row.recording_id is null then
    raise exception 'recording not found' using errcode = 'P0002';
  end if;
  if v_row.input_version <> p_expected_input_version then
    return null;
  end if;

  v_changed := v_row.confirmed_start_sec is distinct from p_start_sec
            or v_row.confirmed_end_sec is distinct from p_end_sec
            or v_row.confirmed_transcript_version is distinct from v_row.current_transcript_version;

  update public.recording_sermon_media
     set confirmed_start_sec = p_start_sec,
         confirmed_end_sec = p_end_sec,
         confirmed_by = p_user_id,
         confirmed_at = now(),
         confirmed_transcript_version = current_transcript_version,
         input_version = case when v_changed then input_version + 1 else input_version end,
         updated_at = now()
   where recording_id = p_recording_id
  returning input_version into v_row.input_version;

  if v_changed then
    perform public.flag_sermon_media_drafts(p_recording_id, 'The sermon start or end changed.');
  end if;
  return v_row.input_version;
end;
$$;

-- Save a staff transcript edit as a new version, optimistic on the version the
-- editor started from. Bumps the input version when an edited segment overlaps
-- the confirmed range. Returns the new version, or null when stale.
create or replace function public.save_transcript_edit(
  p_recording_id uuid,
  p_church_id uuid,
  p_based_on_version integer,
  p_segments jsonb,
  p_touched_start_sec numeric,
  p_touched_end_sec numeric,
  p_user_id uuid,
  p_note text default null
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_row public.recording_sermon_media;
  v_base public.recording_transcripts;
  v_version integer;
  v_overlaps boolean;
begin
  select * into v_row from public.recording_sermon_media
   where recording_id = p_recording_id and church_id = p_church_id for update;
  if v_row.recording_id is null or v_row.current_transcript_version is distinct from p_based_on_version then
    return null;
  end if;
  select * into v_base from public.recording_transcripts
   where recording_id = p_recording_id and version = p_based_on_version;

  v_version := p_based_on_version + 1;
  select greatest(v_version, coalesce(max(version), 0) + 1) into v_version
    from public.recording_transcripts where recording_id = p_recording_id;

  insert into public.recording_transcripts (
    church_id, recording_id, version, kind, based_on_version, language, engine, duration_sec,
    segments, gaps, audio_events, edit_note, created_by
  ) values (
    p_church_id, p_recording_id, v_version, 'edited', p_based_on_version, v_base.language, v_base.engine,
    v_base.duration_sec, p_segments, v_base.gaps, v_base.audio_events, left(p_note, 300), p_user_id
  );

  v_overlaps := v_row.confirmed_start_sec is not null
    and p_touched_start_sec < v_row.confirmed_end_sec
    and p_touched_end_sec > v_row.confirmed_start_sec;

  update public.recording_sermon_media
     set current_transcript_version = v_version,
         input_version = case when v_overlaps then input_version + 1 else input_version end,
         updated_at = now()
   where recording_id = p_recording_id;

  if v_overlaps then
    perform public.flag_sermon_media_drafts(p_recording_id, 'The sermon transcript was corrected.');
  end if;
  return v_version;
end;
$$;

-- Server-only: no browser role may run any of these.
revoke all on function public.enqueue_media_job(uuid, uuid, text, uuid, text, jsonb, text, uuid, integer) from public, anon, authenticated;
revoke all on function public.claim_media_jobs(text, integer, integer, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.mark_media_job_dispatch(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.touch_media_job(uuid, uuid, uuid, text, real, integer) from public, anon, authenticated;
revoke all on function public.fail_media_job(uuid, uuid, uuid, text, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.commit_machine_transcript(uuid, uuid, uuid, text, text, numeric, jsonb, jsonb, jsonb, jsonb) from public, anon, authenticated;
revoke all on function public.commit_clip_render(uuid, uuid, uuid, text, bigint, text, jsonb, jsonb, boolean, jsonb) from public, anon, authenticated;
revoke all on function public.flag_sermon_media_drafts(uuid, text) from public, anon, authenticated;
revoke all on function public.confirm_sermon_range(uuid, uuid, numeric, numeric, uuid, integer) from public, anon, authenticated;
revoke all on function public.save_transcript_edit(uuid, uuid, integer, jsonb, numeric, numeric, uuid, text) from public, anon, authenticated;
grant execute on function public.enqueue_media_job(uuid, uuid, text, uuid, text, jsonb, text, uuid, integer) to service_role;
grant execute on function public.claim_media_jobs(text, integer, integer, integer, timestamptz) to service_role;
grant execute on function public.mark_media_job_dispatch(uuid, uuid, text, text) to service_role;
grant execute on function public.touch_media_job(uuid, uuid, uuid, text, real, integer) to service_role;
grant execute on function public.fail_media_job(uuid, uuid, uuid, text, text, boolean, jsonb) to service_role;
grant execute on function public.commit_machine_transcript(uuid, uuid, uuid, text, text, numeric, jsonb, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.commit_clip_render(uuid, uuid, uuid, text, bigint, text, jsonb, jsonb, boolean, jsonb) to service_role;
grant execute on function public.flag_sermon_media_drafts(uuid, text) to service_role;
grant execute on function public.confirm_sermon_range(uuid, uuid, numeric, numeric, uuid, integer) to service_role;
grant execute on function public.save_transcript_edit(uuid, uuid, integer, jsonb, numeric, numeric, uuid, text) to service_role;

-- Private bucket for rendered clips. No client policies: the server signs reads,
-- and the worker receives one signed upload URL per render.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('sermon-clips', 'sermon-clips', false, 524288000, array['video/mp4', 'image/jpeg'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
