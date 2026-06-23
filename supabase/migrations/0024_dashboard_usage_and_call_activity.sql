-- FaithForm: Pastor dashboard time tracking + phone call activity backfill
-- Migration 0024

-- ---------------------------------------------------------------------------
-- DASHBOARD USAGE (daily active seconds per user on faithform.io)
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.dashboard_usage_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  church_id UUID NOT NULL REFERENCES public.churches (id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  usage_date DATE NOT NULL,
  active_seconds INT NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (church_id, user_id, usage_date)
);

CREATE INDEX IF NOT EXISTS dashboard_usage_daily_church_date_idx
  ON public.dashboard_usage_daily (church_id, usage_date DESC);

CREATE INDEX IF NOT EXISTS dashboard_usage_daily_user_date_idx
  ON public.dashboard_usage_daily (user_id, usage_date DESC);

ALTER TABLE public.dashboard_usage_daily ENABLE ROW LEVEL SECURITY;

CREATE POLICY dashboard_usage_daily_select ON public.dashboard_usage_daily
  FOR SELECT TO authenticated
  USING (church_id IN (SELECT public.user_church_ids()));

CREATE POLICY dashboard_usage_daily_insert ON public.dashboard_usage_daily
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND church_id IN (SELECT public.user_church_ids())
  );

CREATE POLICY dashboard_usage_daily_update ON public.dashboard_usage_daily
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    AND church_id IN (SELECT public.user_church_ids())
  )
  WITH CHECK (
    user_id = auth.uid()
    AND church_id IN (SELECT public.user_church_ids())
  );

-- ---------------------------------------------------------------------------
-- BACKFILL: phone calls missing from activity_log
-- ---------------------------------------------------------------------------

INSERT INTO public.activity_log (
  church_id,
  automation_type,
  category,
  task_name,
  time_saved_minutes,
  trigger_source,
  executed_at
)
SELECT
  pc.church_id,
  'Phone Call + Duration of Call',
  'Phone',
  CASE
    WHEN NULLIF(pc.caller_number, '') IS NOT NULL THEN
      'AI answered call from ' || pc.caller_number
    ELSE
      'AI answered phone call'
  END,
  GREATEST(
    5,
    CASE
      WHEN pc.duration_seconds IS NULL OR pc.duration_seconds <= 0 THEN 5
      ELSE CEIL(pc.duration_seconds / 60.0)::INT
    END
  ),
  'phone_call:' || COALESCE(pc.retail_ai_call_id, pc.id::text),
  pc.called_at
FROM public.phone_calls pc
WHERE NOT EXISTS (
  SELECT 1
  FROM public.activity_log al
  WHERE al.trigger_source = 'phone_call:' || COALESCE(pc.retail_ai_call_id, pc.id::text)
);

NOTIFY pgrst, 'reload schema';
