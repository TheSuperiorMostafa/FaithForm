-- Migration 0172
--
-- Transcripts & Clips studio: the automatic pipeline after each service, a
-- one-tap approval queue for clips, and scheduled Facebook posting.
--
-- Additive only. Columns on tables created by 0170; no policy or grant
-- changes (all remain service-role only).

-- How a church's studio runs. Defaults: confident sermon ranges are confirmed
-- automatically, three clips are prepared per service, and approved clips post
-- one a day at noon on weekdays, church time.
alter table public.sermon_media_settings
  add column if not exists auto_confirm_range boolean not null default true,
  add column if not exists auto_clips boolean not null default true,
  add column if not exists clips_per_service integer not null default 3,
  add column if not exists post_schedule jsonb not null
    default '{"days":[1,2,3,4,5],"time":"12:00","per_day":1}'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sermon_media_settings_clips_per_service') then
    alter table public.sermon_media_settings
      add constraint sermon_media_settings_clips_per_service check (clips_per_service between 0 and 6);
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sermon_media_settings_post_schedule') then
    alter table public.sermon_media_settings
      add constraint sermon_media_settings_post_schedule check (
        jsonb_typeof(post_schedule) = 'object' and octet_length(post_schedule::text) <= 1024);
  end if;
end $$;

-- The range was confirmed by FaithForm from strong evidence, not by a person.
-- Staff can still move it; doing so clears this flag.
alter table public.recording_sermon_media
  add column if not exists confirmed_automatically boolean not null default false,
  -- When the automatic pipeline last ran for this recording's current input.
  add column if not exists pipeline_input_version integer;

-- One-tap approval and scheduled posting.
--   pending  — waiting for someone to watch and approve
--   approved — approved render will post at scheduled_for (or now, if null)
--   skipped  — not for posting
--   posted   — handed to Facebook (see facebook_reel_posts for its status)
alter table public.sermon_clips
  add column if not exists approval_status text not null default 'pending',
  add column if not exists approved_render_id uuid references public.sermon_clip_renders (id) on delete set null,
  add column if not exists approved_by uuid,
  add column if not exists approved_at timestamptz,
  add column if not exists approved_page_id text,
  add column if not exists scheduled_for timestamptz,
  add column if not exists auto boolean not null default false;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'sermon_clips_approval_status') then
    alter table public.sermon_clips
      add constraint sermon_clips_approval_status
      check (approval_status in ('pending', 'approved', 'skipped', 'posted'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'sermon_clips_approval_complete') then
    alter table public.sermon_clips
      add constraint sermon_clips_approval_complete check (
        approval_status not in ('approved', 'posted')
        or (approved_render_id is not null and approved_by is not null and approved_page_id is not null));
  end if;
end $$;

create index if not exists sermon_clips_due
  on public.sermon_clips (scheduled_for)
  where approval_status = 'approved';
create index if not exists sermon_clips_church_queue
  on public.sermon_clips (church_id, approval_status, updated_at desc)
  where status <> 'archived';
