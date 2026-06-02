do $$
declare
  target_user_id uuid;
begin
  select id
  into target_user_id
  from auth.users
  where lower(email) = 'superiormostafa@gmail.com'
  limit 1;

  if target_user_id is not null then
    insert into public.platform_admins (user_id)
    values (target_user_id)
    on conflict (user_id) do nothing;

    insert into public.church_users (church_id, user_id, role)
    values (
      '11111111-1111-1111-1111-111111111111',
      target_user_id,
      'admin'
    )
    on conflict (church_id, user_id) do update
      set role = 'admin';
  end if;
end $$;
