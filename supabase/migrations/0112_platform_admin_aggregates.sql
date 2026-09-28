-- Platform admin pages must aggregate in PostgreSQL. PostgREST caps ordinary
-- row responses, so summing the first page silently understates totals as the
-- number of churches grows. These functions run with the service role's own
-- privileges and expose only aggregate results.
-- The current live branch introduced this reporting flag before this release.
-- Create it here as well so a fresh sequential migration chain can define the
-- aggregate functions; 0127 marks the existing internal workspaces.
alter table public.churches
  add column if not exists exclude_from_platform_metrics boolean not null default false;

create or replace function public.admin_platform_totals(since_date date)
returns table (
  minutes_saved bigint,
  giving_cents bigint,
  pastor_seconds_30d bigint,
  active_churches_30d bigint
)
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select
    (select coalesce(sum(a.time_saved_minutes), 0)::bigint
       from public.activity_log a join public.churches c on c.id = a.church_id
      where not c.exclude_from_platform_metrics),
    (select coalesce(sum(g.amount_cents), 0)::bigint
       from public.giving_donations g join public.churches c on c.id = g.church_id
      where g.status = 'succeeded' and not c.exclude_from_platform_metrics),
    (select coalesce(sum(u.active_seconds), 0)::bigint
       from public.dashboard_usage_daily u join public.churches c on c.id = u.church_id
      where u.usage_date >= since_date and not c.exclude_from_platform_metrics),
    (select count(distinct u.church_id)::bigint
       from public.dashboard_usage_daily u join public.churches c on c.id = u.church_id
      where u.usage_date >= since_date and u.active_seconds > 0
        and not c.exclude_from_platform_metrics);
$$;

create or replace function public.admin_platform_church_metrics()
returns table (
  church_id uuid,
  users_count bigint,
  sermons_count bigint,
  last_active_at timestamptz
)
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select c.id,
         coalesce(u.users_count, 0),
         coalesce(s.sermons_count, 0),
         a.last_active_at
    from public.churches c
    left join (
      select church_id, count(*)::bigint as users_count
        from public.church_users group by church_id
    ) u on u.church_id = c.id
    left join (
      select church_id, count(*)::bigint as sermons_count
        from public.sermons group by church_id
    ) s on s.church_id = c.id
    left join (
      select church_id, max(executed_at) as last_active_at
        from public.activity_log group by church_id
    ) a on a.church_id = c.id;
$$;

create or replace function public.admin_platform_analytics(
  since_month timestamptz,
  since_recent timestamptz
)
returns table (metric text, bucket text, total numeric)
language sql stable security invoker
set search_path = pg_catalog, public
as $$
  select 'churches_month'::text,
         to_char(date_trunc('month', c.created_at at time zone 'UTC'), 'YYYY-MM'),
         count(*)::numeric
    from public.churches c
   where c.created_at >= since_month and not c.exclude_from_platform_metrics
   group by 2
  union all
  select 'activity_minutes_month'::text,
         to_char(date_trunc('month', a.executed_at at time zone 'UTC'), 'YYYY-MM'),
         coalesce(sum(a.time_saved_minutes), 0)::numeric
    from public.activity_log a join public.churches c on c.id = a.church_id
   where a.executed_at >= since_month and not c.exclude_from_platform_metrics
   group by 2
  union all
  select 'sermon_model'::text,
         coalesce(nullif(s.model_used, ''), 'Unknown'),
         count(*)::numeric
    from public.sermons s join public.churches c on c.id = s.church_id
   where s.created_at >= since_month and not c.exclude_from_platform_metrics
   group by 2
  union all
  select 'activity_type'::text,
         coalesce(nullif(a.automation_type, ''), 'Unknown'),
         count(*)::numeric
    from public.activity_log a join public.churches c on c.id = a.church_id
   where a.executed_at >= since_recent and not c.exclude_from_platform_metrics
   group by 2;
$$;

revoke all on function public.admin_platform_totals(date) from public, anon, authenticated;
revoke all on function public.admin_platform_church_metrics() from public, anon, authenticated;
revoke all on function public.admin_platform_analytics(timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.admin_platform_totals(date) to service_role;
grant execute on function public.admin_platform_church_metrics() to service_role;
grant execute on function public.admin_platform_analytics(timestamptz, timestamptz)
  to service_role;
