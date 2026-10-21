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
