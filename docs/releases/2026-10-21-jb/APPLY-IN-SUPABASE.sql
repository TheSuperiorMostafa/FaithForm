-- FaithForm production project: wwiclymyfplsyezxyzva
-- Apply this file in the Supabase SQL editor BEFORE activating the release.
-- Run the entire file. Any failure rolls back the whole batch.
-- Exact checksum matches are skipped; changed applied files are rejected.
begin;
set local lock_timeout = '3s';
set local statement_timeout = '120s';
select pg_advisory_xact_lock(hashtext('faithform_jb_october_2026_release'));
do $target$ begin
 if not exists(select 1 from public.churches where id='d1d65673-2d45-4825-9e6e-c2d85d4583fd' and slug='faithform-onboarding-qa-8fb4f6a5') then
   raise exception 'Wrong target: expected the verified FaithForm project';
 end if;
end $target$;
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.faithform_source_migrations (
 filename text primary key, sha256 text not null, applied_at timestamptz not null default clock_timestamp()
);
revoke all on supabase_migrations.faithform_source_migrations from public, anon, authenticated;

-- 0135_upcoming_service_recording_details.sql
do $migration_0135$
declare previous text;
begin
 select sha256 into previous from supabase_migrations.faithform_source_migrations where filename='0135_upcoming_service_recording_details.sql';
 if previous is not null then
  if previous <> '21bb580647d84eb99826be29c7aaa75f7af25f5007c41dce21f5db3dba14422d' then raise exception 'Applied checksum differs: 0135_upcoming_service_recording_details.sql'; end if;
  raise notice 'Already applied: 0135_upcoming_service_recording_details.sql';
  return;
 end if;
 execute $source_0135$
-- Add recording details without changing previously applied migrations.
ALTER TABLE public.stream_events
  ADD COLUMN IF NOT EXISTS speaker_tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS chapter_tags TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS topic_tags TEXT[] NOT NULL DEFAULT '{}';

CREATE OR REPLACE FUNCTION public.inherit_scheduled_recording_details()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE service public.stream_events%ROWTYPE;
BEGIN
  IF NEW.stream_event_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO service FROM public.stream_events
  WHERE id = NEW.stream_event_id AND church_id = NEW.church_id;
  IF FOUND THEN
    NEW.title := COALESCE(NULLIF(BTRIM(NEW.title), ''), service.title);
    NEW.mobile_summary := COALESCE(NULLIF(BTRIM(NEW.mobile_summary), ''), service.description);
    IF COALESCE(cardinality(NEW.speaker_tags), 0) = 0 THEN NEW.speaker_tags := service.speaker_tags; END IF;
    IF COALESCE(cardinality(NEW.chapter_tags), 0) = 0 THEN NEW.chapter_tags := service.chapter_tags; END IF;
    IF COALESCE(cardinality(NEW.topic_tags), 0) = 0 THEN NEW.topic_tags := service.topic_tags; END IF;
    NEW.series_id := COALESCE(NEW.series_id, service.series_id);
    NEW.artwork_poster_url := COALESCE(NEW.artwork_poster_url, service.artwork_poster_url);
    NEW.artwork_wide_url := COALESCE(NEW.artwork_wide_url, service.artwork_wide_url, service.artwork_url);
    NEW.artwork_banner_url := COALESCE(NEW.artwork_banner_url, service.artwork_banner_url);
  END IF;
  RETURN NEW;
END;
$$;
-- Ensure the insert-only trigger exists even on a partially reconciled deployment.
-- Published recording edits remain independent.
DROP TRIGGER IF EXISTS inherit_scheduled_recording_details ON public.stream_recordings;
CREATE TRIGGER inherit_scheduled_recording_details BEFORE INSERT ON public.stream_recordings
FOR EACH ROW EXECUTE FUNCTION public.inherit_scheduled_recording_details();
REVOKE ALL ON FUNCTION public.inherit_scheduled_recording_details() FROM PUBLIC;
NOTIFY pgrst, 'reload schema';

$source_0135$;
 insert into supabase_migrations.faithform_source_migrations(filename,sha256) values ('0135_upcoming_service_recording_details.sql','21bb580647d84eb99826be29c7aaa75f7af25f5007c41dce21f5db3dba14422d');
end $migration_0135$;

-- 0136_attendance_sms_tracking.sql
do $migration_0136$
declare previous text;
begin
 select sha256 into previous from supabase_migrations.faithform_source_migrations where filename='0136_attendance_sms_tracking.sql';
 if previous is not null then
  if previous <> '297ed6bc88525b7697696da584fc924fb7d9a0373504461c7ede853a64bc1c5e' then raise exception 'Applied checksum differs: 0136_attendance_sms_tracking.sql'; end if;
  raise notice 'Already applied: 0136_attendance_sms_tracking.sql';
  return;
 end if;
 execute $source_0136$
-- Accepted API requests are distinct from handset-confirmed sends.
alter table public.attendance_follow_up_log
  drop constraint if exists attendance_follow_up_log_status_check;
alter table public.attendance_follow_up_log
  add constraint attendance_follow_up_log_status_check
  check (status in ('queued', 'sent', 'failed', 'skipped'));
alter table public.attendance_follow_up_log
  add column if not exists delivery_confirmed_at timestamptz,
  add column if not exists app_checked_at timestamptz,
  add column if not exists app_checked_by uuid references auth.users(id) on delete set null,
  add column if not exists delivery_checked_at timestamptz;

-- Existing history predates the required handset check. Do not retroactively
-- make old attendance pages demand confirmation or award old sends time credit.
update public.attendance_follow_up_log set app_checked_at = created_at where app_checked_at is null;

create index if not exists attendance_follow_up_pending_delivery_idx
  on public.attendance_follow_up_log (delivery_checked_at nulls first, created_at)
  where status = 'queued' and sms_id is not null;
create index if not exists attendance_follow_up_app_check_idx
  on public.attendance_follow_up_log (church_id, service_date)
  where app_checked_at is null and status in ('queued', 'sent');

-- The log already restricts writes to the service role. Keep this function
-- SECURITY INVOKER so the trigger cannot expand a caller's privileges.
create or replace function public.credit_confirmed_attendance_sms()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare source_key text;
begin
  if new.status <> 'sent' or new.delivery_confirmed_at is null or new.sms_id is null then
    return new;
  end if;
  source_key := 'attendance_sms:' || new.church_id::text || ':' || new.sms_id;
  -- Provider retries and overlapping reconciliation runs must credit once.
  perform pg_advisory_xact_lock(hashtextextended(source_key, 0));
  if not exists (select 1 from public.activity_log where church_id = new.church_id and trigger_source = source_key) then
    insert into public.activity_log (church_id, automation_type, category, task_name, time_saved_minutes, trigger_source, executed_at)
    values (new.church_id, 'Attendance Follow-up Text', 'Communication',
      'Attendance follow-up text sent', 2, source_key, new.delivery_confirmed_at);
  end if;
  return new;
end;
$$;
revoke all on function public.credit_confirmed_attendance_sms() from public, anon, authenticated;
drop trigger if exists attendance_sms_confirmed_credit on public.attendance_follow_up_log;
create trigger attendance_sms_confirmed_credit
  after insert or update of status, delivery_confirmed_at on public.attendance_follow_up_log
  for each row execute function public.credit_confirmed_attendance_sms();

$source_0136$;
 insert into supabase_migrations.faithform_source_migrations(filename,sha256) values ('0136_attendance_sms_tracking.sql','297ed6bc88525b7697696da584fc924fb7d9a0373504461c7ede853a64bc1c5e');
end $migration_0136$;

-- 0137_retell_call_lifecycle.sql
do $migration_0137$
declare previous text;
begin
 select sha256 into previous from supabase_migrations.faithform_source_migrations where filename='0137_retell_call_lifecycle.sql';
 if previous is not null then
  if previous <> 'db8b0c99a8166f3b1a0a7494267c87b4c2d7ca30dda637919fac2fbae1686761' then raise exception 'Applied checksum differs: 0137_retell_call_lifecycle.sql'; end if;
  raise notice 'Already applied: 0137_retell_call_lifecycle.sql';
  return;
 end if;
 execute $source_0137$
-- Retell lifecycle state is separate from the church's call classification.
-- NULL provider type retains genuine legacy telephone records.
ALTER TABLE public.phone_calls
  ADD COLUMN IF NOT EXISTS provider_call_type text,
  ADD COLUMN IF NOT EXISTS call_status text;

ALTER TABLE public.phone_calls
  ADD CONSTRAINT phone_calls_provider_call_type_check
    CHECK (provider_call_type IS NULL OR provider_call_type IN ('phone_call', 'web_call')),
  ADD CONSTRAINT phone_calls_provider_status_check
    CHECK (call_status IS NULL OR call_status IN ('ongoing', 'ended', 'analyzed'));

-- Retell does not wait for a webhook acknowledgement before sending the next
-- event. A late started/ended request must never overwrite completed analysis.
CREATE OR REPLACE FUNCTION public.preserve_retell_call_lifecycle()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF OLD.call_status = 'analyzed' AND NEW.call_status IN ('ongoing', 'ended')
    OR OLD.call_status = 'ended' AND NEW.call_status = 'ongoing' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.preserve_retell_call_lifecycle() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER phone_calls_preserve_retell_lifecycle
  BEFORE UPDATE ON public.phone_calls
  FOR EACH ROW EXECUTE FUNCTION public.preserve_retell_call_lifecycle();

NOTIFY pgrst, 'reload schema';

$source_0137$;
 insert into supabase_migrations.faithform_source_migrations(filename,sha256) values ('0137_retell_call_lifecycle.sql','db8b0c99a8166f3b1a0a7494267c87b4c2d7ca30dda637919fac2fbae1686761');
end $migration_0137$;

-- 0138_staff_notifications.sql
do $migration_0138$
declare previous text;
begin
 select sha256 into previous from supabase_migrations.faithform_source_migrations where filename='0138_staff_notifications.sql';
 if previous is not null then
  if previous <> '6c521ec7abb66ddb7a7cad488c280398c856ce04832282354d302d2c13889768' then raise exception 'Applied checksum differs: 0138_staff_notifications.sql'; end if;
  raise notice 'Already applied: 0138_staff_notifications.sql';
  return;
 end if;
 execute $source_0138$
create table public.staff_notification_preferences (
  church_id uuid not null references public.churches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  phone text not null default '',
  events jsonb not null default '{}',
  updated_at timestamptz not null default now(),
  primary key(church_id, user_id)
);
alter table public.staff_notification_preferences enable row level security;
revoke all on public.staff_notification_preferences from public, anon, authenticated;
grant select on public.staff_notification_preferences to authenticated;
grant all on public.staff_notification_preferences to service_role;
create policy staff_notification_preferences_select on public.staff_notification_preferences
  for select to authenticated using (user_id = auth.uid() and church_id in (select public.user_church_ids()));

create table public.staff_notification_jobs (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  event text not null check(event in ('attendance_documents','attendance_completed','kids_alerts')),
  event_key text not null,
  channel text not null check(channel in ('email','phone')),
  href text not null,
  status text not null default 'queued' check(status in ('queued','sending','sent','failed','skipped')),
  attempts integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(church_id, user_id, event, event_key, channel)
);
alter table public.staff_notification_jobs enable row level security;
revoke all on public.staff_notification_jobs from public, anon, authenticated;
grant all on public.staff_notification_jobs to service_role;
create index staff_notification_jobs_pending on public.staff_notification_jobs(created_at) where status in ('queued','sending');

create function public.claim_staff_notification_jobs(p_limit integer default 10)
returns setof public.staff_notification_jobs
language sql security invoker set search_path = public as $$
  update staff_notification_jobs set status = 'sending', updated_at = now(), attempts = attempts + 1
  where id in (
    select id from staff_notification_jobs
    where (status = 'queued' or (status = 'sending' and channel = 'email' and updated_at < now() - interval '5 minutes'))
      and attempts < 3
    order by created_at for update skip locked limit least(greatest(p_limit, 1), 50)
  ) returning *;
$$;
revoke all on function public.claim_staff_notification_jobs(integer) from public, anon, authenticated;
grant execute on function public.claim_staff_notification_jobs(integer) to service_role;

$source_0138$;
 insert into supabase_migrations.faithform_source_migrations(filename,sha256) values ('0138_staff_notifications.sql','6c521ec7abb66ddb7a7cad488c280398c856ce04832282354d302d2c13889768');
end $migration_0138$;

-- 0139_church_health.sql
do $migration_0139$
declare previous text;
begin
 select sha256 into previous from supabase_migrations.faithform_source_migrations where filename='0139_church_health.sql';
 if previous is not null then
  if previous <> 'd11c60ab5ede469c18540986a02811d2d1016b51033029c87be97c9056f8c0a9' then raise exception 'Applied checksum differs: 0139_church_health.sql'; end if;
  raise notice 'Already applied: 0139_church_health.sql';
  return;
 end if;
 execute $source_0139$
-- Internal customer health signals. Church users cannot read staff risk notes.
create table public.church_health_reviews (
  church_id uuid primary key references public.churches(id) on delete cascade,
  status text not null check (status in ('yellow', 'red')),
  note text not null check (length(trim(note)) between 1 and 1000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.church_health_reviews enable row level security;
revoke all on public.church_health_reviews from public, anon, authenticated;
grant all on public.church_health_reviews to service_role;

-- One row per church avoids truncated dashboard-usage reads at the API limit.
create function public.admin_church_health_signals()
returns table(church_id uuid, recent_days bigint, previous_days bigint,
  last_seen_at timestamptz, open_tickets bigint, health_override text, health_note text)
language sql stable security invoker set search_path = public as $$
  select c.id,
    (select count(distinct d.usage_date) from dashboard_usage_daily d where d.church_id = c.id and d.active_seconds > 0 and d.usage_date > current_date - 7),
    (select count(distinct d.usage_date) from dashboard_usage_daily d where d.church_id = c.id and d.active_seconds > 0 and d.usage_date > current_date - 14 and d.usage_date <= current_date - 7),
    (select max(d.last_seen_at) from dashboard_usage_daily d where d.church_id = c.id and d.active_seconds > 0),
    (select count(*) from support_tickets t where t.church_id = c.id and t.status <> 'resolved'),
    r.status, r.note
  from churches c left join church_health_reviews r on r.church_id = c.id;
$$;
revoke all on function public.admin_church_health_signals() from public, anon, authenticated;
grant execute on function public.admin_church_health_signals() to service_role;

$source_0139$;
 insert into supabase_migrations.faithform_source_migrations(filename,sha256) values ('0139_church_health.sql','d11c60ab5ede469c18540986a02811d2d1016b51033029c87be97c9056f8c0a9');
end $migration_0139$;

commit;
-- Read-only verification: expect five rows with recorded source checksums.
select filename, sha256, applied_at from supabase_migrations.faithform_source_migrations
 where filename in ('0135_upcoming_service_recording_details.sql','0136_attendance_sms_tracking.sql','0137_retell_call_lifecycle.sql','0138_staff_notifications.sql','0139_church_health.sql') order by filename;
