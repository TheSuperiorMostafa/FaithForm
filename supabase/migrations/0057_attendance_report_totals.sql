-- Faithful: correct the attendance report's totals
-- Migration 0057 (Prompt 7)
--
-- Additive. Replaces one function body; creates and alters nothing else.
-- `0055` is not edited — it may already have been applied somewhere.
--
-- ## The defect
--
-- `attendance_report` aggregates over a *grouped* subquery:
--
--     from (
--       select f.source, f.status, count(*) as n
--       from public.attendance_facts f
--       where f.service_occurrence_id = o.id
--       group by f.source, f.status
--     ) af
--
-- and then counted with `count(*) filter (where af.status = 'active')`. But
-- `af` has **one row per (source, status) pair**, not one row per fact — so
-- `count(*)` counted *groups*. The `by_source` breakdown was right all along,
-- because it used `n`; only the headline totals were wrong.
--
--   three people counted — two by phone, one by a greeter
--     → groups: (geofence, active, n=2), (manual, active, n=1)
--     → reported total: 2
--     → actual attendance: 3
--
-- ## Why it was invisible until now
--
-- With a single source there is a single group, and the number of groups
-- happens to equal the number of facts. Prompt 6 shipped with manual entry as
-- the only source that had ever produced a fact, so the two numbers coincided.
-- Prompt 7 introduces the second source, and the day a congregation uses both
-- the dashboard would have started under-reporting its own attendance — the
-- one number a church actually looks at.
--
-- Found by an executable test that seeded a mixed-source occurrence and
-- compared the report against the facts. No amount of reading the SQL had
-- surfaced it; the shape looks entirely reasonable.
--
-- ## The fix
--
-- `sum(af.n)` instead of `count(*)`. `sum` returns null over an empty set,
-- hence the `coalesce`, and the cast is explicit so the signature is unchanged.
-- Everything else — the joins, the ordering, the grants — is byte-identical to
-- 0055 on purpose: this migration fixes one arithmetic error and changes
-- nothing else about who may call the function or what it returns.

create or replace function public.attendance_report(
  p_church_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_campus_id uuid default null,
  p_source text default null
)
returns table (
  occurrence_id uuid,
  label text,
  local_service_date date,
  starts_at_utc timestamptz,
  campus_name text,
  counted integer,
  reversed integer,
  by_source jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  select
    o.id,
    o.label,
    o.local_service_date,
    o.starts_at_utc,
    cc.name,
    coalesce(counts.active_count, 0)::integer,
    coalesce(counts.reversed_count, 0)::integer,
    coalesce(counts.by_source, '{}'::jsonb)
  from public.service_occurrences o
  left join public.church_campuses cc on cc.id = o.campus_id
  left join lateral (
    select
      -- `sum(n)`, not `count(*)`: `af` is one row per (source, status), so
      -- counting rows counts *sources* rather than people. This is the fix.
      coalesce(sum(af.n) filter (where af.status = 'active'), 0)::integer as active_count,
      coalesce(sum(af.n) filter (where af.status = 'reversed'), 0)::integer as reversed_count,
      -- Unchanged, and was always correct: it summed `n` rather than rows.
      coalesce(
        jsonb_object_agg(af.source, af.n) filter (where af.status = 'active'),
        '{}'::jsonb
      ) as by_source
    from (
      select f.source, f.status, count(*)::integer as n
      from public.attendance_facts f
      where f.service_occurrence_id = o.id
        and (p_source is null or f.source = p_source)
      group by f.source, f.status
    ) af
  ) counts on true
  where o.church_id = p_church_id
    and o.starts_at_utc >= p_from
    and o.starts_at_utc < p_to
    and (p_campus_id is null or o.campus_id = p_campus_id)
  order by o.starts_at_utc desc, o.id desc
$$;

-- Identical to 0055's grants, restated because `create or replace` does not
-- change them and restating makes the privilege visible in one place. Nothing
-- is widened: `authenticated` is revoked here exactly as it was there.
revoke all on function public.attendance_report(uuid, timestamptz, timestamptz, uuid, text)
  from public, anon, authenticated;
grant execute on function public.attendance_report(uuid, timestamptz, timestamptz, uuid, text)
  to service_role;

notify pgrst, 'reload schema';
