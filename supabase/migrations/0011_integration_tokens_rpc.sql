-- Server-side token access for church admins (avoids requiring SUPABASE_SECRET_KEY on Vercel)

create or replace function public.get_church_integration_tokens(
  p_church_id uuid,
  p_provider text
)
returns table (
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  metadata jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  select
    ci.access_token,
    ci.refresh_token,
    ci.token_expires_at,
    ci.metadata
  from public.church_integrations ci
  where ci.church_id = p_church_id
    and ci.provider = p_provider
    and public.is_church_admin(p_church_id);
$$;

revoke all on function public.get_church_integration_tokens(uuid, text) from public;
grant execute on function public.get_church_integration_tokens(uuid, text) to authenticated;
