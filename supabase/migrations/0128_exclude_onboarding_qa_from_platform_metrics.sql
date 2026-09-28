-- The onboarding QA church has a different name from the earlier internal
-- workspaces. Keep its synthetic activity out of platform reporting while
-- preserving its data and church-facing features.
update public.churches
set exclude_from_platform_metrics = true
where lower(btrim(name)) = 'faithform onboarding qa'
  and exclude_from_platform_metrics is not true;
