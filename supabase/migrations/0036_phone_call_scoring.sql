-- Phone call recording URL, success flag, and AI scoring fields

ALTER TABLE public.phone_calls
  ADD COLUMN IF NOT EXISTS recording_url text,
  ADD COLUMN IF NOT EXISTS call_successful boolean,
  ADD COLUMN IF NOT EXISTS score_breakdown jsonb,
  ADD COLUMN IF NOT EXISTS scored_at timestamptz;

NOTIFY pgrst, 'reload schema';
