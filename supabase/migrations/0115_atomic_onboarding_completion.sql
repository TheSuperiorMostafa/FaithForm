-- Finish a church invitation in one transaction. Server code verifies the
-- signed-in user and passes that user's email; browser roles cannot execute.
create or replace function public.complete_church_onboarding(
  p_token text,
  p_user_id uuid,
  p_user_email text
)
returns text
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_invite public.church_invites%rowtype;
  v_completed_at timestamptz;
  v_now timestamptz := now();
begin
  if p_token is null or length(p_token) < 32 or p_user_id is null or p_user_email is null then
    return 'invalid';
  end if;

  select * into v_invite from public.church_invites
   where token = p_token
   for update;
  if not found then
    return 'invalid';
  end if;
  if v_invite.accepted_at is not null then
    return 'already_accepted';
  end if;
  if v_invite.expires_at < v_now then
    return 'expired';
  end if;
  if lower(btrim(v_invite.email)) <> lower(btrim(p_user_email)) then
    return 'email_mismatch';
  end if;

  select onboarding_completed_at into v_completed_at from public.churches
   where id = v_invite.church_id
   for update;
  if not found then
    return 'invalid';
  end if;
  if v_completed_at is not null then
    return 'already_complete';
  end if;

  insert into public.church_users (church_id, user_id, role, onboarding_step)
  values (v_invite.church_id, p_user_id, 'admin', 'completed')
  on conflict (church_id, user_id) do update
    set role = 'admin', onboarding_step = 'completed';

  update public.churches
     set onboarding_completed_at = v_now
   where id = v_invite.church_id;

  update public.church_invites
     set accepted_at = v_now
   where id = v_invite.id;

  return 'completed';
end;
$$;

revoke all on function public.complete_church_onboarding(text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.complete_church_onboarding(text, uuid, text)
  to service_role;

notify pgrst, 'reload schema';
