-- Platform admin pages must aggregate in PostgreSQL. PostgREST caps ordinary
-- row responses, so summing the first page silently understates totals as the
-- number of churches grows. These functions run with the service role's own
-- privileges and expose only aggregate results.

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
    (select coalesce(sum(time_saved_minutes), 0)::bigint from public.activity_log),
    (select coalesce(sum(amount_cents), 0)::bigint
       from public.giving_donations where status = 'succeeded'),
    (select coalesce(sum(active_seconds), 0)::bigint
       from public.dashboard_usage_daily where usage_date >= since_date),
    (select count(distinct church_id)::bigint
       from public.dashboard_usage_daily
      where usage_date >= since_date and active_seconds > 0);
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
         to_char(date_trunc('month', created_at at time zone 'UTC'), 'YYYY-MM'),
         count(*)::numeric
    from public.churches where created_at >= since_month
   group by 2
  union all
  select 'activity_minutes_month'::text,
         to_char(date_trunc('month', executed_at at time zone 'UTC'), 'YYYY-MM'),
         coalesce(sum(time_saved_minutes), 0)::numeric
    from public.activity_log where executed_at >= since_month
   group by 2
  union all
  select 'sermon_model'::text,
         coalesce(nullif(model_used, ''), 'Unknown'),
         count(*)::numeric
    from public.sermons where created_at >= since_month
   group by 2
  union all
  select 'activity_type'::text,
         coalesce(nullif(automation_type, ''), 'Unknown'),
         count(*)::numeric
    from public.activity_log where executed_at >= since_recent
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
