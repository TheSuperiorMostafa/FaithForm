-- Persist the next ten weekly services, each with its own editable details.
-- The original schedule snapshot is kept separately from per-week edits.
ALTER TABLE public.stream_events
  ADD COLUMN IF NOT EXISTS recurrence_group_id UUID,
  ADD COLUMN IF NOT EXISTS recurrence_time_zone TEXT,
  ADD COLUMN IF NOT EXISTS recurrence_template JSONB,
  ADD COLUMN IF NOT EXISTS recording_app_visibility TEXT
    CHECK (recording_app_visibility IN ('none', 'public', 'followers', 'members')),
  ADD COLUMN IF NOT EXISTS recording_publish_to_website BOOLEAN,
  ADD COLUMN IF NOT EXISTS recording_notify_members BOOLEAN;

CREATE UNIQUE INDEX IF NOT EXISTS stream_events_recurrence_occurrence_idx
  ON public.stream_events (church_id, recurrence_group_id, starts_at)
  WHERE recurrence_group_id IS NOT NULL;

-- Invoker rights preserve the existing church-admin write policies. There is
-- no public RPC and no write during a website, app, or dashboard page read.
CREATE OR REPLACE FUNCTION public.maintain_upcoming_service_horizon()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  schedule_id UUID;
  zone TEXT;
  template JSONB;
  seed public.stream_events%ROWTYPE;
  last_start TIMESTAMPTZ;
  next_start TIMESTAMPTZ;
  remaining INTEGER;
BEGIN
  IF NEW.recurrence_rule IS DISTINCT FROM 'weekly' THEN RETURN NEW; END IF;
  -- Child inserts already belong to the group. Only its root fills the
  -- horizon; later status changes replenish it under the same group lock.
  IF TG_OP = 'INSERT' AND NEW.recurrence_group_id IS NOT NULL THEN RETURN NEW; END IF;
  IF TG_OP = 'UPDATE' AND NEW.status IS NOT DISTINCT FROM OLD.status
      AND NEW.recurrence_group_id IS NOT NULL THEN RETURN NEW; END IF;
  schedule_id := COALESCE(NEW.recurrence_group_id, NEW.id);
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.church_id::text || ':' || schedule_id::text, 0));
  zone := NEW.recurrence_time_zone;
  IF zone IS NULL THEN SELECT timezone INTO zone FROM public.churches WHERE id = NEW.church_id; END IF;
  zone := COALESCE(zone, 'America/New_York');
  IF NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = zone) THEN
    RAISE EXCEPTION 'Choose a valid church time zone';
  END IF;
  template := COALESCE(NEW.recurrence_template, to_jsonb(NEW));
  IF NEW.recurrence_group_id IS NULL THEN
    UPDATE public.stream_events
      SET recurrence_group_id = schedule_id, recurrence_time_zone = zone, recurrence_template = template
      WHERE id = NEW.id AND church_id = NEW.church_id;
  END IF;
  seed := jsonb_populate_record(NULL::public.stream_events, template);
  SELECT COUNT(*) FILTER (WHERE status = 'scheduled' AND starts_at >= now()), MAX(starts_at)
    INTO remaining, last_start FROM public.stream_events
    WHERE church_id = NEW.church_id AND recurrence_group_id = schedule_id;
  WHILE remaining < 10 LOOP
    -- Add seven days on the church's clock, preserving Sunday service time
    -- across daylight-saving changes. Cancelled weeks are never recreated.
    next_start := ((last_start AT TIME ZONE zone) + INTERVAL '7 days') AT TIME ZONE zone;
    last_start := next_start;
    IF next_start < now() THEN CONTINUE; END IF;
    INSERT INTO public.stream_events (
      church_id, title, starts_at, recurrence_rule, recurrence_group_id,
      recurrence_time_zone, recurrence_template, syndicate_youtube, syndicate_facebook,
      youtube_privacy, chat_enabled, countdown_enabled, public_access, created_by,
      speaker_tags, description, chapter_tags, topic_tags, series_id, artwork_url,
      artwork_poster_url, artwork_wide_url, artwork_banner_url, simulated,
      simulated_source_path, recording_app_visibility, recording_publish_to_website,
      recording_notify_members
    ) VALUES (
      NEW.church_id, seed.title, next_start, 'weekly', schedule_id,
      zone, template, seed.syndicate_youtube, seed.syndicate_facebook,
      seed.youtube_privacy, seed.chat_enabled, seed.countdown_enabled, seed.public_access,
      NEW.created_by,
      seed.speaker_tags, seed.description, seed.chapter_tags, seed.topic_tags,
      CASE WHEN EXISTS (SELECT 1 FROM public.media_series WHERE id = seed.series_id AND church_id = NEW.church_id) THEN seed.series_id END,
      seed.artwork_url, seed.artwork_poster_url, seed.artwork_wide_url,
      seed.artwork_banner_url, seed.simulated, seed.simulated_source_path,
      seed.recording_app_visibility, seed.recording_publish_to_website, seed.recording_notify_members
    );
    remaining := remaining + 1;
  END LOOP;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.maintain_upcoming_service_horizon() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER maintain_upcoming_service_horizon
  AFTER INSERT OR UPDATE OF status ON public.stream_events
  FOR EACH ROW EXECUTE FUNCTION public.maintain_upcoming_service_horizon();

-- Existing upcoming schedules acquire independent future rows, without
-- touching any ended recording or changing its publication state.
UPDATE public.stream_events SET status = status
  WHERE recurrence_rule = 'weekly' AND status IN ('scheduled', 'live') AND recurrence_group_id IS NULL;
NOTIFY pgrst, 'reload schema';
