-- FaithForm: Social media assets for event Facebook posts (Claude + Placid pipeline)
-- Migration 0023 (non-destructive: no DROP TABLE, no DROP POLICY, no data deletes)

-- ---------------------------------------------------------------------------
-- SOCIAL BACKGROUND IMAGES (tagged stock library)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.social_background_images (
  id text PRIMARY KEY,
  storage_path text NOT NULL,
  tags text[] NOT NULL DEFAULT '{}',
  attribution text,
  source_url text,
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS social_background_images_tags_idx
  ON public.social_background_images USING gin (tags);

CREATE INDEX IF NOT EXISTS social_background_images_active_idx
  ON public.social_background_images (active, sort_order);

ALTER TABLE public.social_background_images ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'social_background_images'
      AND policyname = 'social_background_images_select'
  ) THEN
    CREATE POLICY social_background_images_select ON public.social_background_images
      FOR SELECT TO anon, authenticated
      USING (active = true);
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- SOCIAL TEMPLATES (Placid template UUID mapping)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.social_templates (
  key text PRIMARY KEY,
  placid_template_uuid text NOT NULL DEFAULT '',
  description text NOT NULL DEFAULT '',
  active boolean NOT NULL DEFAULT true,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.social_templates ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'social_templates'
      AND policyname = 'social_templates_select'
  ) THEN
    CREATE POLICY social_templates_select ON public.social_templates
      FOR SELECT TO anon, authenticated
      USING (active = true);
  END IF;
END $$;

INSERT INTO public.social_templates (key, placid_template_uuid, description, sort_order)
VALUES
  ('general', '', 'Default event graphic template', 1),
  ('youth', '', 'Youth-focused event template', 2),
  ('outreach', '', 'Outreach and community event template', 3),
  ('worship-night', '', 'Worship night event template', 4)
ON CONFLICT (key) DO NOTHING;

-- ---------------------------------------------------------------------------
-- ANNOUNCEMENTS: social preview fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.announcements
  ADD COLUMN IF NOT EXISTS facebook_caption text,
  ADD COLUMN IF NOT EXISTS social_graphic_url text,
  ADD COLUMN IF NOT EXISTS social_graphic_path text,
  ADD COLUMN IF NOT EXISTS social_preview_generated_at timestamptz;

-- ---------------------------------------------------------------------------
-- STORAGE: social-backgrounds bucket (public read)
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'social-backgrounds',
  'social-backgrounds',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public read access for social backgrounds'
  ) THEN
    CREATE POLICY "Public read access for social backgrounds"
      ON storage.objects FOR SELECT
      TO public
      USING (bucket_id = 'social-backgrounds');
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- STORAGE: social-graphics bucket (public read for Placid + Facebook)
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'social-graphics',
  'social-graphics',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Public read access for social graphics'
  ) THEN
    CREATE POLICY "Public read access for social graphics"
      ON storage.objects FOR SELECT
      TO public
      USING (bucket_id = 'social-graphics');
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'Authenticated users can upload social graphics'
  ) THEN
    CREATE POLICY "Authenticated users can upload social graphics"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'social-graphics'
        AND (storage.foldername(name))[1] IS NOT NULL
      );
  END IF;
END $$;
