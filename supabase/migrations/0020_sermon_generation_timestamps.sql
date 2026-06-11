-- Track first-time sermon generation events for reliable hours-saved derivation.

ALTER TABLE public.sermons
  ADD COLUMN IF NOT EXISTS outline_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS content_generated_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz;

UPDATE public.sermons
SET outline_generated_at = updated_at
WHERE outline IS NOT NULL AND outline_generated_at IS NULL;

UPDATE public.sermons
SET content_generated_at = updated_at
WHERE content IS NOT NULL AND content_generated_at IS NULL;

UPDATE public.sermons
SET published_at = updated_at
WHERE status = 'published' AND published_at IS NULL;
