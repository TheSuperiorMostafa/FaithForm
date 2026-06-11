-- Backfill activity_log for all churches from existing operational data.
-- Idempotent via trigger_source keys prefixed with backfill:

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
  ar.church_id,
  'Track Weekly Attendance',
  'Admin',
  'Weekly attendance recorded',
  5,
  'backfill:attendance:' || ar.id::text,
  ar.submitted_at
FROM public.attendance_records ar
WHERE NOT EXISTS (
  SELECT 1
  FROM public.activity_log al
  WHERE al.trigger_source = 'backfill:attendance:' || ar.id::text
);

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
  a.church_id,
  'Publish Announcement',
  'Communications',
  COALESCE(NULLIF(a.title, ''), NULLIF(a.event_title, ''), 'Untitled announcement'),
  15,
  'backfill:announcement:' || a.id::text,
  a.created_at
FROM public.announcements a
WHERE NOT EXISTS (
  SELECT 1
  FROM public.activity_log al
  WHERE al.trigger_source = 'backfill:announcement:' || a.id::text
);

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
  s.church_id,
  'Sermon Created',
  'Admin',
  s.title,
  10,
  'backfill:sermon:create:' || s.id::text,
  s.created_at
FROM public.sermons s
WHERE NOT EXISTS (
  SELECT 1
  FROM public.activity_log al
  WHERE al.trigger_source = 'backfill:sermon:create:' || s.id::text
);

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
  s.church_id,
  'Sermon Published',
  'Admin',
  s.title,
  5,
  'backfill:sermon:publish:' || s.id::text,
  s.updated_at
FROM public.sermons s
WHERE s.status = 'published'
  AND NOT EXISTS (
    SELECT 1
    FROM public.activity_log al
    WHERE al.trigger_source = 'backfill:sermon:publish:' || s.id::text
  );

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
  s.church_id,
  CASE sa.kind
    WHEN 'social_snippet' THEN 'Social Snippet Generated'
    WHEN 'discussion_questions' THEN 'Discussion Questions Generated'
    WHEN 'export_pdf' THEN 'Sermon PDF Exported'
    WHEN 'export_pptx' THEN 'Sermon PPTX Exported'
  END,
  CASE sa.kind
    WHEN 'social_snippet' THEN 'Social'
    ELSE 'Admin'
  END,
  s.title,
  CASE sa.kind
    WHEN 'social_snippet' THEN 7
    WHEN 'discussion_questions' THEN 10
    WHEN 'export_pdf' THEN 8
    WHEN 'export_pptx' THEN 12
  END,
  'backfill:sermon_asset:' || sa.id::text,
  sa.created_at
FROM public.sermon_assets sa
INNER JOIN public.sermons s ON s.id = sa.sermon_id
WHERE NOT EXISTS (
  SELECT 1
  FROM public.activity_log al
  WHERE al.trigger_source = 'backfill:sermon_asset:' || sa.id::text
);

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
  COALESCE(NULLIF(pc.caller_number, ''), NULLIF(pc.call_type, ''), 'Phone call'),
  5,
  'backfill:phone_call:' || pc.id::text,
  pc.called_at
FROM public.phone_calls pc
WHERE NOT EXISTS (
  SELECT 1
  FROM public.activity_log al
  WHERE al.trigger_source = 'backfill:phone_call:' || pc.id::text
);
