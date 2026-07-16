-- FaithForm: Church Profile single source of truth
-- Migration 0038

-- ---------------------------------------------------------------------------
-- CHURCHES: profile hub columns
-- ---------------------------------------------------------------------------

ALTER TABLE public.churches
  ADD COLUMN IF NOT EXISTS tagline TEXT,
  ADD COLUMN IF NOT EXISTS mission_statement TEXT,
  ADD COLUMN IF NOT EXISTS vision_statement TEXT,
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS cover_image_url TEXT,
  ADD COLUMN IF NOT EXISTS email TEXT,
  ADD COLUMN IF NOT EXISTS google_maps_url TEXT,
  ADD COLUMN IF NOT EXISTS denomination TEXT,
  ADD COLUMN IF NOT EXISTS office_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS holiday_schedule TEXT,
  ADD COLUMN IF NOT EXISTS facebook_url TEXT,
  ADD COLUMN IF NOT EXISTS instagram_url TEXT,
  ADD COLUMN IF NOT EXISTS youtube_url TEXT,
  ADD COLUMN IF NOT EXISTS tiktok_url TEXT,
  ADD COLUMN IF NOT EXISTS x_url TEXT,
  ADD COLUMN IF NOT EXISTS podcast_url TEXT,
  ADD COLUMN IF NOT EXISTS livestream_url TEXT,
  ADD COLUMN IF NOT EXISTS ai_knowledge JSONB NOT NULL DEFAULT '{}'::jsonb;

-- Backfill denomination from church_settings / voice_assistant_settings
UPDATE public.churches c
SET denomination = COALESCE(
  NULLIF(TRIM(c.denomination), ''),
  (
    SELECT NULLIF(TRIM(cs.denomination), '')
    FROM public.church_settings cs
    WHERE cs.church_id = c.id
  ),
  (
    SELECT NULLIF(TRIM(vas.denomination), '')
    FROM public.voice_assistant_settings vas
    WHERE vas.church_id = c.id
  )
)
WHERE c.denomination IS NULL OR TRIM(c.denomination) = '';

-- Backfill office_hours from voice_assistant_settings
UPDATE public.churches c
SET office_hours = vas.office_hours
FROM public.voice_assistant_settings vas
WHERE vas.church_id = c.id
  AND vas.office_hours IS NOT NULL
  AND vas.office_hours <> '{}'::jsonb
  AND (c.office_hours IS NULL OR c.office_hours = '{}'::jsonb);

-- Sync VAS church_phone from churches.phone where missing
UPDATE public.voice_assistant_settings vas
SET church_phone = c.phone
FROM public.churches c
WHERE c.id = vas.church_id
  AND c.phone IS NOT NULL
  AND TRIM(c.phone) <> ''
  AND (vas.church_phone IS NULL OR TRIM(vas.church_phone) = '');

-- ---------------------------------------------------------------------------
-- CHURCH SERVICE TIMES
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.church_service_times (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES public.churches (id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 0 AND 6),
  start_time TIME NOT NULL,
  end_time TIME,
  kind TEXT NOT NULL DEFAULT 'regular'
    CHECK (kind IN ('regular', 'midweek', 'other')),
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS church_service_times_church_id_idx
  ON public.church_service_times (church_id, sort_order);

-- ---------------------------------------------------------------------------
-- CHURCH STAFF
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.church_staff (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES public.churches (id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  title TEXT,
  email TEXT,
  phone TEXT,
  photo_url TEXT,
  bio TEXT,
  is_senior_pastor BOOLEAN NOT NULL DEFAULT false,
  is_executive_pastor BOOLEAN NOT NULL DEFAULT false,
  ai_contact_priority INTEGER NOT NULL DEFAULT 0,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_public BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS church_staff_church_id_idx
  ON public.church_staff (church_id, sort_order);

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.church_service_times ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.church_staff ENABLE ROW LEVEL SECURITY;

CREATE POLICY church_service_times_select ON public.church_service_times
  FOR SELECT TO authenticated
  USING (church_id IN (SELECT public.user_church_ids()));

CREATE POLICY church_service_times_insert ON public.church_service_times
  FOR INSERT TO authenticated
  WITH CHECK (public.is_church_admin(church_id));

CREATE POLICY church_service_times_update ON public.church_service_times
  FOR UPDATE TO authenticated
  USING (public.is_church_admin(church_id))
  WITH CHECK (public.is_church_admin(church_id));

CREATE POLICY church_service_times_delete ON public.church_service_times
  FOR DELETE TO authenticated
  USING (public.is_church_admin(church_id));

CREATE POLICY church_staff_select ON public.church_staff
  FOR SELECT TO authenticated
  USING (church_id IN (SELECT public.user_church_ids()));

CREATE POLICY church_staff_insert ON public.church_staff
  FOR INSERT TO authenticated
  WITH CHECK (public.is_church_admin(church_id));

CREATE POLICY church_staff_update ON public.church_staff
  FOR UPDATE TO authenticated
  USING (public.is_church_admin(church_id))
  WITH CHECK (public.is_church_admin(church_id));

CREATE POLICY church_staff_delete ON public.church_staff
  FOR DELETE TO authenticated
  USING (public.is_church_admin(church_id));

-- Admins may update their church profile row
CREATE POLICY churches_update ON public.churches
  FOR UPDATE TO authenticated
  USING (public.is_church_admin(id))
  WITH CHECK (public.is_church_admin(id));

-- ---------------------------------------------------------------------------
-- STORAGE: church-covers bucket
-- ---------------------------------------------------------------------------

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'church-covers',
  'church-covers',
  true,
  5242880,
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
ON CONFLICT (id) DO UPDATE SET
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

CREATE POLICY "Authenticated users can upload church covers"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'church-covers'
    AND (storage.foldername(name))[1] IS NOT NULL
  );

CREATE POLICY "Public read access for church covers"
  ON storage.objects FOR SELECT
  TO public
  USING (bucket_id = 'church-covers');

CREATE POLICY "Authenticated users can update church covers"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'church-covers')
  WITH CHECK (bucket_id = 'church-covers');

CREATE POLICY "Authenticated users can delete church covers"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'church-covers');

NOTIFY pgrst, 'reload schema';
