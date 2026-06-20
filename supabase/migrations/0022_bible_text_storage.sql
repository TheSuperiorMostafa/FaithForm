-- Self-hosted Bible translation JSON files (private — not public due to licensing)

CREATE TABLE IF NOT EXISTS public.bible_text_translations (
  code text PRIMARY KEY,
  label text NOT NULL,
  storage_path text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.bible_text_translations ENABLE ROW LEVEL SECURITY;

-- Catalog is read by authenticated users (enabled/disabled in UI only)
DROP POLICY IF EXISTS bible_text_translations_select ON public.bible_text_translations;
CREATE POLICY bible_text_translations_select ON public.bible_text_translations
  FOR SELECT TO authenticated
  USING (active = true);

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'bible-text',
  'bible-text',
  false,
  104857600,
  ARRAY['application/json']
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
