-- Sermon Builder tables (run after 0001–0005)
-- Uses existing RLS helpers: user_church_ids(), is_church_admin()

DO $$ BEGIN
  CREATE TYPE ai_provider AS ENUM ('anthropic', 'openai');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE sermon_status AS ENUM ('draft', 'published');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE sermon_asset_kind AS ENUM (
    'discussion_questions',
    'social_snippet',
    'export_pdf',
    'export_pptx'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.church_settings (
  church_id UUID PRIMARY KEY REFERENCES public.churches (id) ON DELETE CASCADE,
  ai_provider ai_provider NOT NULL DEFAULT 'anthropic',
  ai_model_override TEXT,
  default_translation TEXT NOT NULL DEFAULT 'ESV',
  preaching_style TEXT,
  denomination TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sermon_series (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES public.churches (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  theme TEXT NOT NULL,
  description TEXT,
  weeks_planned INT NOT NULL DEFAULT 4,
  plan JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sermons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES public.churches (id) ON DELETE CASCADE,
  created_by UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  series_id UUID REFERENCES public.sermon_series (id) ON DELETE SET NULL,
  title TEXT NOT NULL DEFAULT 'Untitled Sermon',
  scripture_refs TEXT[] NOT NULL DEFAULT '{}',
  topic TEXT NOT NULL DEFAULT '',
  audience TEXT NOT NULL DEFAULT 'General congregation',
  duration_min INT NOT NULL DEFAULT 30,
  style_notes TEXT,
  status sermon_status NOT NULL DEFAULT 'draft',
  content JSONB,
  outline JSONB,
  model_used TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.sermon_assets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sermon_id UUID NOT NULL REFERENCES public.sermons (id) ON DELETE CASCADE,
  kind sermon_asset_kind NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sermons_church_id ON public.sermons (church_id);
CREATE INDEX IF NOT EXISTS idx_sermons_series_id ON public.sermons (series_id);
CREATE INDEX IF NOT EXISTS idx_sermon_series_church_id ON public.sermon_series (church_id);
CREATE INDEX IF NOT EXISTS idx_sermon_assets_sermon_id ON public.sermon_assets (sermon_id);

ALTER TABLE public.church_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sermon_series ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sermons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sermon_assets ENABLE ROW LEVEL SECURITY;

-- church_settings
DROP POLICY IF EXISTS church_settings_select ON public.church_settings;
CREATE POLICY church_settings_select ON public.church_settings
  FOR SELECT TO authenticated
  USING (church_id IN (SELECT public.user_church_ids()));

DROP POLICY IF EXISTS church_settings_insert ON public.church_settings;
CREATE POLICY church_settings_insert ON public.church_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_church_admin(church_id));

DROP POLICY IF EXISTS church_settings_update ON public.church_settings;
CREATE POLICY church_settings_update ON public.church_settings
  FOR UPDATE TO authenticated
  USING (public.is_church_admin(church_id))
  WITH CHECK (public.is_church_admin(church_id));

-- sermon_series
DROP POLICY IF EXISTS sermon_series_select ON public.sermon_series;
CREATE POLICY sermon_series_select ON public.sermon_series
  FOR SELECT TO authenticated
  USING (church_id IN (SELECT public.user_church_ids()));

DROP POLICY IF EXISTS sermon_series_insert ON public.sermon_series;
CREATE POLICY sermon_series_insert ON public.sermon_series
  FOR INSERT TO authenticated
  WITH CHECK (church_id IN (SELECT public.user_church_ids()));

DROP POLICY IF EXISTS sermon_series_update ON public.sermon_series;
CREATE POLICY sermon_series_update ON public.sermon_series
  FOR UPDATE TO authenticated
  USING (church_id IN (SELECT public.user_church_ids()));

DROP POLICY IF EXISTS sermon_series_delete ON public.sermon_series;
CREATE POLICY sermon_series_delete ON public.sermon_series
  FOR DELETE TO authenticated
  USING (church_id IN (SELECT public.user_church_ids()));

-- sermons
DROP POLICY IF EXISTS sermons_select ON public.sermons;
CREATE POLICY sermons_select ON public.sermons
  FOR SELECT TO authenticated
  USING (church_id IN (SELECT public.user_church_ids()));

DROP POLICY IF EXISTS sermons_insert ON public.sermons;
CREATE POLICY sermons_insert ON public.sermons
  FOR INSERT TO authenticated
  WITH CHECK (church_id IN (SELECT public.user_church_ids()));

DROP POLICY IF EXISTS sermons_update ON public.sermons;
CREATE POLICY sermons_update ON public.sermons
  FOR UPDATE TO authenticated
  USING (church_id IN (SELECT public.user_church_ids()));

DROP POLICY IF EXISTS sermons_delete ON public.sermons;
CREATE POLICY sermons_delete ON public.sermons
  FOR DELETE TO authenticated
  USING (church_id IN (SELECT public.user_church_ids()));

-- sermon_assets
DROP POLICY IF EXISTS sermon_assets_select ON public.sermon_assets;
CREATE POLICY sermon_assets_select ON public.sermon_assets
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sermons s
      WHERE s.id = sermon_id
        AND s.church_id IN (SELECT public.user_church_ids())
    )
  );

DROP POLICY IF EXISTS sermon_assets_insert ON public.sermon_assets;
CREATE POLICY sermon_assets_insert ON public.sermon_assets
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.sermons s
      WHERE s.id = sermon_id
        AND s.church_id IN (SELECT public.user_church_ids())
    )
  );

DROP POLICY IF EXISTS sermon_assets_delete ON public.sermon_assets;
CREATE POLICY sermon_assets_delete ON public.sermon_assets
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.sermons s
      WHERE s.id = sermon_id
        AND s.church_id IN (SELECT public.user_church_ids())
    )
  );

-- Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
