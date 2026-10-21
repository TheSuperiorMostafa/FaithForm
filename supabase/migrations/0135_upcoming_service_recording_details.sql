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
