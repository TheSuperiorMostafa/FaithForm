-- FaithForm: Voice assistant settings + phone call webhook fields
-- Migration 0018

-- ---------------------------------------------------------------------------
-- VOICE ASSISTANT SETTINGS (1:1 per church)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.voice_assistant_settings (
  church_id UUID PRIMARY KEY REFERENCES public.churches (id) ON DELETE CASCADE,
  assistant_name TEXT,
  denomination TEXT,
  church_phone TEXT,
  emergency_phone TEXT,
  tone TEXT NOT NULL DEFAULT 'warm_friendly'
    CHECK (tone IN ('warm_friendly', 'professional', 'traditional_formal')),
  speaking_pace TEXT NOT NULL DEFAULT 'normal'
    CHECK (speaking_pace IN ('slow', 'normal', 'energetic')),
  language TEXT NOT NULL DEFAULT 'en',
  greeting_message TEXT,
  signoff_message TEXT,
  office_hours JSONB NOT NULL DEFAULT '{}'::jsonb,
  after_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  after_hours_message TEXT,
  retail_ai_agent_id TEXT,
  retail_ai_phone_number TEXT,
  agent_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- PHONE CALLS: Retail AI webhook fields
-- ---------------------------------------------------------------------------

ALTER TABLE public.phone_calls
  ADD COLUMN IF NOT EXISTS retail_ai_call_id TEXT,
  ADD COLUMN IF NOT EXISTS transcript TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS phone_calls_retail_ai_call_id_key
  ON public.phone_calls (retail_ai_call_id)
  WHERE retail_ai_call_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------

ALTER TABLE public.voice_assistant_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY voice_assistant_settings_select ON public.voice_assistant_settings
  FOR SELECT TO authenticated
  USING (church_id IN (SELECT public.user_church_ids()));

CREATE POLICY voice_assistant_settings_insert ON public.voice_assistant_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.is_church_admin(church_id));

CREATE POLICY voice_assistant_settings_update ON public.voice_assistant_settings
  FOR UPDATE TO authenticated
  USING (public.is_church_admin(church_id))
  WITH CHECK (public.is_church_admin(church_id));

NOTIFY pgrst, 'reload schema';
