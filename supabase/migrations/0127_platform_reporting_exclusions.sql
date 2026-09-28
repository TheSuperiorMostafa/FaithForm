-- Control Center reporting can omit internal workspaces without deleting their
-- data or changing the church-facing dashboard. Existing churches stay included.
alter table public.churches
  add column if not exists exclude_from_platform_metrics boolean not null default false;

-- These two internal workspaces should not inflate production totals. The
-- Control Center can change this setting later for any church.
update public.churches
set exclude_from_platform_metrics = true
where lower(btrim(name)) in ('faithform test', 'faithform qa');

comment on column public.churches.exclude_from_platform_metrics is
  'Omit this church from Control Center platform totals and analytics; keep its own data and access.';
