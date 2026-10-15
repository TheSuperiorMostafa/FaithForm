-- 0119 already provides series_week and its 1..52 constraint.
-- Preserve existing multiple sermons per week while linking unambiguous legacy rows.
-- Attach legacy sermons only when both the sermon and planned week have one match.
-- Title/topic were copied from the original week by the old Start action.
WITH candidates AS (
  SELECT s.id, s.series_id, (w.value->>'week')::INTEGER AS week,
    COUNT(*) OVER (PARTITION BY s.id) AS sermon_matches,
    COUNT(*) OVER (PARTITION BY s.series_id, w.value->>'week') AS week_matches
  FROM public.sermons s
  JOIN public.sermon_series sr ON sr.id = s.series_id AND sr.church_id = s.church_id
  CROSS JOIN LATERAL jsonb_array_elements(COALESCE(sr.plan->'weeks', '[]'::jsonb)) w(value)
  WHERE s.series_week IS NULL
    AND (CASE WHEN (w.value->>'week') ~ '^[1-9][0-9]{0,8}$'
      THEN (w.value->>'week')::INTEGER BETWEEN 1 AND 52 ELSE FALSE END)
    AND NULLIF(BTRIM(w.value->>'title'), '') IS NOT NULL
    AND (LOWER(BTRIM(s.title)) = LOWER(BTRIM(w.value->>'title'))
      OR LOWER(BTRIM(s.topic)) = LOWER(BTRIM(w.value->>'title')))
)
UPDATE public.sermons s SET series_week = c.week
FROM candidates c
WHERE s.id = c.id AND c.sermon_matches = 1 AND c.week_matches = 1
  AND NOT EXISTS (
    SELECT 1 FROM public.sermons linked
    WHERE linked.series_id = c.series_id AND linked.series_week = c.week
  );
