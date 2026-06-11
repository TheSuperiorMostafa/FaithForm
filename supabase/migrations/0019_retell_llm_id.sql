-- FaithForm: Retell LLM id for voice assistant sync
-- Migration 0019

ALTER TABLE public.voice_assistant_settings
  ADD COLUMN IF NOT EXISTS retell_llm_id TEXT;
