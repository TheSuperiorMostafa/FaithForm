-- Male / Female voice selection for Retell agents
ALTER TABLE public.voice_assistant_settings
  ADD COLUMN IF NOT EXISTS voice_gender TEXT NOT NULL DEFAULT 'male';

ALTER TABLE public.voice_assistant_settings
  DROP CONSTRAINT IF EXISTS voice_assistant_settings_voice_gender_check;

ALTER TABLE public.voice_assistant_settings
  ADD CONSTRAINT voice_assistant_settings_voice_gender_check
  CHECK (voice_gender IN ('male', 'female'));
