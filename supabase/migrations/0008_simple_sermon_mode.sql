-- Simple Sermon Builder mode columns (run after 0006_sermon_builder.sql)

ALTER TABLE public.church_settings
  ADD COLUMN IF NOT EXISTS sermon_builder_mode TEXT NOT NULL DEFAULT 'simple'
  CHECK (sermon_builder_mode IN ('simple', 'advanced'));

ALTER TABLE public.sermons
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'advanced'
  CHECK (kind IN ('simple', 'advanced'));

ALTER TABLE public.sermons
  ADD COLUMN IF NOT EXISTS theme_id TEXT;

ALTER TABLE public.sermons
  ADD COLUMN IF NOT EXISTS translation TEXT;

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
