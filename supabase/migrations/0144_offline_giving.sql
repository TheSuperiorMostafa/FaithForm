-- Offline gifts never create Stripe payments. Only the authenticated dashboard
-- action may call this service-only, atomic, idempotent write.
create unique index giving_donations_offline_batch_row_key
  on public.giving_donations (church_id, (metadata->>'offline_batch'), (metadata->>'offline_row'))
  where metadata ? 'offline_batch';

create function public.record_offline_gifts(p_church_id uuid, p_actor_id uuid, p_batch_id uuid, p_gifts jsonb)
returns integer language plpgsql security invoker set search_path = '' as $$
declare gift jsonb; donor uuid; fund uuid; amount integer; ordinal integer := 0; existing integer;
begin
  if not exists (select 1 from public.church_users where church_id = p_church_id and user_id = p_actor_id and role = 'admin') then
    raise exception 'Church admin required';
  end if;
  if p_batch_id is null or p_gifts is null or jsonb_typeof(p_gifts) <> 'array' then
    raise exception 'Invalid gift batch';
  end if;
  if jsonb_array_length(p_gifts) not between 1 and 500 then
    raise exception 'Invalid gift batch';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_church_id::text || p_batch_id::text, 0));
  select count(*) into existing from public.giving_donations
    where church_id = p_church_id and metadata->>'offline_batch' = p_batch_id::text;
  if existing > 0 then return existing; end if;
  for gift in select value from jsonb_array_elements(p_gifts) loop
    ordinal := ordinal + 1;
    fund := (gift->>'fund_id')::uuid;
    amount := (gift->>'amount_cents')::integer;
    if amount is null or amount <= 0 or not exists (
      select 1 from public.giving_funds where id = fund and church_id = p_church_id and is_active
    ) or coalesce(gift->>'method', '') not in ('cash', 'check', 'other') or coalesce(gift->>'gift_type', '') not in ('one_time', 'recurring') then
      raise exception 'Invalid offline gift';
    end if;
    donor := nullif(gift->>'donor_id', '')::uuid;
    if donor is not null then
      if not exists (select 1 from public.giving_donors where id = donor and church_id = p_church_id) then
        raise exception 'Donor not in church';
      end if;
    elsif nullif(gift->>'donor_email', '') is not null then
      insert into public.giving_donors (church_id, email, name)
        values (p_church_id, lower(gift->>'donor_email'), nullif(gift->>'donor_name', ''))
        on conflict (church_id, email) do update set name = coalesce(public.giving_donors.name, excluded.name)
        returning id into donor;
    end if;
    insert into public.giving_donations (
      church_id, amount_cents, intended_amount_cents, currency, status, gift_type,
      donor_id, donor_name, donor_email, fund_id, fee_covered, stripe_fee_cents, net_amount_cents,
      created_at, metadata
    ) values (
      p_church_id, amount, amount, 'usd', 'succeeded', gift->>'gift_type', donor,
      coalesce((select name from public.giving_donors where id = donor), nullif(gift->>'donor_name', '')),
      coalesce((select email from public.giving_donors where id = donor), nullif(gift->>'donor_email', '')),
      fund, false, 0, amount, (gift->>'date')::date + time '12:00' at time zone 'UTC',
      jsonb_build_object('source', 'offline', 'payment_method', gift->>'method',
        'recorded_by', p_actor_id, 'offline_batch', p_batch_id, 'offline_row', ordinal)
    );
  end loop;
  return ordinal;
end;
$$;
revoke all on function public.record_offline_gifts(uuid, uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.record_offline_gifts(uuid, uuid, uuid, jsonb) to service_role;
