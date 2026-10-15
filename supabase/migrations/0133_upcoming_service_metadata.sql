-- Upcoming services share recording metadata; inherit only when a recording is created.
ALTER TABLE public.stream_events
  ADD COLUMN IF NOT EXISTS series_id UUID REFERENCES public.media_series(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS artwork_poster_url TEXT,
  ADD COLUMN IF NOT EXISTS artwork_wide_url TEXT,
  ADD COLUMN IF NOT EXISTS artwork_banner_url TEXT,
  ADD COLUMN IF NOT EXISTS simulated_playout_url TEXT;

-- Older simulated jobs stored the video capability in the artwork field.
UPDATE public.stream_events SET simulated_playout_url = artwork_url, artwork_url = NULL
WHERE simulated = TRUE AND artwork_url LIKE '%/storage/v1/object/sign/%';

CREATE OR REPLACE FUNCTION public.check_stream_event_series_church()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.series_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.media_series WHERE id = NEW.series_id AND church_id = NEW.church_id
  ) THEN RAISE EXCEPTION 'Series must belong to the service church'; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER stream_event_series_church BEFORE INSERT OR UPDATE OF series_id, church_id
ON public.stream_events FOR EACH ROW EXECUTE FUNCTION public.check_stream_event_series_church();

CREATE OR REPLACE FUNCTION public.inherit_scheduled_recording_details()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
DECLARE service public.stream_events%ROWTYPE;
BEGIN
  IF NEW.stream_event_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO service FROM public.stream_events
  WHERE id = NEW.stream_event_id AND church_id = NEW.church_id;
  IF FOUND THEN
    NEW.title := COALESCE(NULLIF(BTRIM(NEW.title), ''), service.title);
    NEW.series_id := COALESCE(NEW.series_id, service.series_id);
    NEW.artwork_poster_url := COALESCE(NEW.artwork_poster_url, service.artwork_poster_url);
    NEW.artwork_wide_url := COALESCE(NEW.artwork_wide_url, service.artwork_wide_url, service.artwork_url);
    NEW.artwork_banner_url := COALESCE(NEW.artwork_banner_url, service.artwork_banner_url);
  END IF;
  RETURN NEW;
END;
$$;
-- Insert-only: later recording edits always retain their own metadata.
CREATE TRIGGER inherit_scheduled_recording_details BEFORE INSERT ON public.stream_recordings
FOR EACH ROW EXECUTE FUNCTION public.inherit_scheduled_recording_details();
REVOKE ALL ON FUNCTION public.check_stream_event_series_church() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.inherit_scheduled_recording_details() FROM PUBLIC;
