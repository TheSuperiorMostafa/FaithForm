-- Safe integration status for church members (no OAuth tokens exposed)

create or replace function public.get_church_integration_status(p_church_id uuid)
returns table (
  provider text,
  connected boolean,
  metadata jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  select
    ci.provider,
    coalesce(ci.access_token, '') <> '' as connected,
    ci.metadata
  from public.church_integrations ci
  where ci.church_id = p_church_id
    and ci.church_id in (select public.user_church_ids());
$$;

revoke all on function public.get_church_integration_status(uuid) from public;
grant execute on function public.get_church_integration_status(uuid) to authenticated;
