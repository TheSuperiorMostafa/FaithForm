-- Internal customer health signals. Church users cannot read staff risk notes.
create table public.church_health_reviews (
  church_id uuid primary key references public.churches(id) on delete cascade,
  status text not null check (status in ('yellow', 'red')),
  note text not null check (length(trim(note)) between 1 and 1000),
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);
alter table public.church_health_reviews enable row level security;
revoke all on public.church_health_reviews from public, anon, authenticated;
grant all on public.church_health_reviews to service_role;

-- One row per church avoids truncated dashboard-usage reads at the API limit.
create function public.admin_church_health_signals()
returns table(church_id uuid, recent_days bigint, previous_days bigint,
  last_seen_at timestamptz, open_tickets bigint, health_override text, health_note text)
language sql stable security invoker set search_path = public as $$
  select c.id,
    (select count(distinct d.usage_date) from dashboard_usage_daily d where d.church_id = c.id and d.active_seconds > 0 and d.usage_date > current_date - 7),
    (select count(distinct d.usage_date) from dashboard_usage_daily d where d.church_id = c.id and d.active_seconds > 0 and d.usage_date > current_date - 14 and d.usage_date <= current_date - 7),
    (select max(d.last_seen_at) from dashboard_usage_daily d where d.church_id = c.id and d.active_seconds > 0),
    (select count(*) from support_tickets t where t.church_id = c.id and t.status <> 'resolved'),
    r.status, r.note
  from churches c left join church_health_reviews r on r.church_id = c.id;
$$;
revoke all on function public.admin_church_health_signals() from public, anon, authenticated;
grant execute on function public.admin_church_health_signals() to service_role;
