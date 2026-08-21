-- Prompt 2 security baseline: atomic claims, tenant isolation, and secret grants.
-- Additive migration. Rehearse in an approved non-production project first.

-- ---------------------------------------------------------------------------
-- DONOR PORTAL: revocation and atomic one-time-token consumption
-- ---------------------------------------------------------------------------

alter table public.giving_donors
  add column if not exists portal_access_revoked_at timestamptz;

alter table public.donor_portal_sessions
  add column if not exists session_expires_at timestamptz,
  add column if not exists revoked_at timestamptz;

create index if not exists donor_portal_sessions_active_idx
  on public.donor_portal_sessions (id, church_id, donor_id, session_expires_at)
  where used_at is not null and revoked_at is null;

create or replace function public.consume_donor_portal_token(
  p_token_hash text,
  p_church_slug text,
  p_session_expires_at timestamptz
)
returns table (session_id uuid, church_id uuid, donor_id uuid)
language sql
security definer
set search_path = public
as $$
  update public.donor_portal_sessions s
     set used_at = clock_timestamp(),
         session_expires_at = p_session_expires_at
    from public.churches c, public.giving_donors d
   where s.token_hash = p_token_hash
     and s.church_id = c.id
     and c.slug = p_church_slug
     and s.donor_id = d.id
     and d.church_id = s.church_id
     and d.portal_access_revoked_at is null
     and s.used_at is null
     and s.revoked_at is null
     and s.expires_at > clock_timestamp()
  returning s.id, s.church_id, s.donor_id;
$$;

revoke all on function public.consume_donor_portal_token(text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.consume_donor_portal_token(text, text, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- INTEGRATIONS: browsers get a safe status projection, never credentials
-- ---------------------------------------------------------------------------

drop policy if exists "church_integrations_select" on public.church_integrations;
drop policy if exists "church_integrations_insert" on public.church_integrations;
drop policy if exists "church_integrations_update" on public.church_integrations;
drop policy if exists "church_integrations_delete" on public.church_integrations;

revoke all on table public.church_integrations from anon, authenticated;
grant select, insert, update, delete on table public.church_integrations to service_role;

revoke all on function public.get_church_integration_tokens(uuid, text)
  from public, anon, authenticated;
grant execute on function public.get_church_integration_tokens(uuid, text)
  to service_role;

-- Retire every value that previously acted as the persistent MediaMTX publish
-- key. The replacement is only an internal, service-role connection marker;
-- capability-based publish auth never reads or compares it. The metadata guard
-- makes a rehearsal/retry idempotent instead of rotating it again.
update public.church_integrations
   set access_token = encode(gen_random_bytes(32), 'hex'),
       metadata = coalesce(metadata, '{}'::jsonb)
         || '{"credential_mode":"capability_v1"}'::jsonb,
       updated_at = clock_timestamp()
 where provider = 'stream'
   and metadata ->> 'credential_mode' is distinct from 'capability_v1';

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
    case ci.provider
      when 'google' then jsonb_strip_nulls(jsonb_build_object(
        'email', ci.metadata -> 'email',
        'calendar_id', ci.metadata -> 'calendar_id',
        'needs_reconnect', ci.metadata -> 'needs_reconnect',
        'last_sync_at', ci.metadata -> 'last_sync_at'
      ))
      when 'facebook' then jsonb_strip_nulls(jsonb_build_object(
        'page_name', ci.metadata -> 'page_name',
        'page_id', ci.metadata -> 'page_id',
        'needs_reconnect', ci.metadata -> 'needs_reconnect',
        'last_sync_at', ci.metadata -> 'last_sync_at'
      ))
      when 'youtube' then jsonb_strip_nulls(jsonb_build_object(
        'channel_id', ci.metadata -> 'channel_id',
        'channel_title', ci.metadata -> 'channel_title',
        'needs_reconnect', ci.metadata -> 'needs_reconnect',
        'last_sync_at', ci.metadata -> 'last_sync_at'
      ))
      when 'stream' then jsonb_strip_nulls(jsonb_build_object(
        'relay_host', ci.metadata -> 'relay_host',
        'last_sync_at', ci.metadata -> 'last_sync_at'
      ))
      else '{}'::jsonb
    end as metadata
  from public.church_integrations ci
  where ci.church_id = p_church_id
    and ci.church_id in (select public.user_church_ids());
$$;

revoke all on function public.get_church_integration_status(uuid)
  from public, anon;
grant execute on function public.get_church_integration_status(uuid)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- STORAGE: the first object-path segment is the authoritative church id
-- ---------------------------------------------------------------------------

drop policy if exists "Authenticated users can upload church logos" on storage.objects;
drop policy if exists "Authenticated users can update church logos" on storage.objects;
drop policy if exists "Authenticated users can delete church logos" on storage.objects;
drop policy if exists "Authenticated users can upload church covers" on storage.objects;
drop policy if exists "Authenticated users can update church covers" on storage.objects;
drop policy if exists "Authenticated users can delete church covers" on storage.objects;
drop policy if exists "Authenticated users can upload social graphics" on storage.objects;
drop policy if exists "Authenticated users can update social graphics" on storage.objects;
drop policy if exists "Authenticated users can delete social graphics" on storage.objects;
drop policy if exists "Tenant admins can upload church logos" on storage.objects;
drop policy if exists "Tenant admins can update church logos" on storage.objects;
drop policy if exists "Tenant admins can delete church logos" on storage.objects;
drop policy if exists "Tenant admins can upload church covers" on storage.objects;
drop policy if exists "Tenant admins can update church covers" on storage.objects;
drop policy if exists "Tenant admins can delete church covers" on storage.objects;
drop policy if exists "Tenant admins can upload social graphics" on storage.objects;
drop policy if exists "Tenant admins can update social graphics" on storage.objects;
drop policy if exists "Tenant admins can delete social graphics" on storage.objects;

create policy "Tenant admins can upload church logos"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'church-logos'
    and exists (
      select 1 from public.church_users cu
       where cu.user_id = auth.uid()
         and cu.role = 'admin'
         and cu.church_id::text = (storage.foldername(name))[1]
    )
  );

create policy "Tenant admins can update church logos"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'church-logos'
    and exists (
      select 1 from public.church_users cu
       where cu.user_id = auth.uid()
         and cu.role = 'admin'
         and cu.church_id::text = (storage.foldername(name))[1]
    )
  )
  with check (
    bucket_id = 'church-logos'
    and exists (
      select 1 from public.church_users cu
       where cu.user_id = auth.uid()
         and cu.role = 'admin'
         and cu.church_id::text = (storage.foldername(name))[1]
    )
  );

create policy "Tenant admins can delete church logos"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'church-logos'
    and exists (
      select 1 from public.church_users cu
       where cu.user_id = auth.uid()
         and cu.role = 'admin'
         and cu.church_id::text = (storage.foldername(name))[1]
    )
  );

create policy "Tenant admins can upload church covers"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'church-covers'
    and exists (
      select 1 from public.church_users cu
       where cu.user_id = auth.uid()
         and cu.role = 'admin'
         and cu.church_id::text = (storage.foldername(name))[1]
    )
  );

create policy "Tenant admins can update church covers"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'church-covers'
    and exists (
      select 1 from public.church_users cu
       where cu.user_id = auth.uid()
         and cu.role = 'admin'
         and cu.church_id::text = (storage.foldername(name))[1]
    )
  )
  with check (
    bucket_id = 'church-covers'
    and exists (
      select 1 from public.church_users cu
       where cu.user_id = auth.uid()
         and cu.role = 'admin'
         and cu.church_id::text = (storage.foldername(name))[1]
    )
  );

create policy "Tenant admins can delete church covers"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'church-covers'
    and exists (
      select 1 from public.church_users cu
       where cu.user_id = auth.uid()
         and cu.role = 'admin'
         and cu.church_id::text = (storage.foldername(name))[1]
    )
  );

create policy "Tenant admins can upload social graphics"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'social-graphics'
    and exists (
      select 1 from public.church_users cu
       where cu.user_id = auth.uid()
         and cu.role = 'admin'
         and cu.church_id::text = (storage.foldername(name))[1]
    )
  );

create policy "Tenant admins can update social graphics"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'social-graphics'
    and exists (
      select 1 from public.church_users cu
       where cu.user_id = auth.uid()
         and cu.role = 'admin'
         and cu.church_id::text = (storage.foldername(name))[1]
    )
  )
  with check (
    bucket_id = 'social-graphics'
    and exists (
      select 1 from public.church_users cu
       where cu.user_id = auth.uid()
         and cu.role = 'admin'
         and cu.church_id::text = (storage.foldername(name))[1]
    )
  );

create policy "Tenant admins can delete social graphics"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'social-graphics'
    and exists (
      select 1 from public.church_users cu
       where cu.user_id = auth.uid()
         and cu.role = 'admin'
         and cu.church_id::text = (storage.foldername(name))[1]
    )
  );

-- Public read policies for the three deliberately public brand/art buckets are
-- retained. Legacy paths remain readable but cannot be mutated by browsers.

-- ---------------------------------------------------------------------------
-- STREAM PUBLICATION AND PUBLIC CHAT
-- ---------------------------------------------------------------------------

alter table public.stream_events
  add column if not exists public_access boolean not null default true;

drop policy if exists "stream_chat_public_select" on public.stream_chat_messages;
drop policy if exists "stream_chat_public_insert" on public.stream_chat_messages;
revoke insert, update, delete on table public.stream_chat_messages from anon;

-- Public chat is mediated by relationship-validating, rate-limited server code.

-- ---------------------------------------------------------------------------
-- ATOMIC RATE LIMITER (service role only)
-- ---------------------------------------------------------------------------

alter table public.api_rate_limits
  add column if not exists expires_at timestamptz;

create index if not exists api_rate_limits_expires_idx
  on public.api_rate_limits (expires_at);

create or replace function public.consume_api_rate_limit(
  p_rate_key text,
  p_limit integer,
  p_window_seconds integer
)
returns table (allowed boolean, retry_after_seconds integer, hit_count integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_window_start timestamptz;
  v_count integer;
begin
  if p_limit < 1 or p_window_seconds < 1 or length(p_rate_key) > 128 then
    raise exception 'invalid rate-limit arguments';
  end if;

  v_window_start := to_timestamp(
    floor(extract(epoch from v_now) / p_window_seconds) * p_window_seconds
  );

  insert into public.api_rate_limits(rate_key, window_start, hit_count, expires_at)
  values (
    p_rate_key,
    v_window_start,
    1,
    v_window_start + make_interval(secs => p_window_seconds * 2)
  )
  on conflict (rate_key) do update
    set window_start = case
          when public.api_rate_limits.window_start = v_window_start
            then public.api_rate_limits.window_start
          else v_window_start
        end,
        hit_count = case
          when public.api_rate_limits.window_start = v_window_start
            then public.api_rate_limits.hit_count + 1
          else 1
        end,
        expires_at = v_window_start + make_interval(secs => p_window_seconds * 2)
  returning public.api_rate_limits.hit_count into v_count;

  return query select
    v_count <= p_limit,
    case when v_count <= p_limit then 0 else greatest(
      1,
      ceil(extract(epoch from (v_window_start + make_interval(secs => p_window_seconds) - v_now)))::integer
    ) end,
    v_count;
end;
$$;

revoke all on function public.consume_api_rate_limit(text, integer, integer)
  from public, anon, authenticated;
grant execute on function public.consume_api_rate_limit(text, integer, integer)
  to service_role;

-- ---------------------------------------------------------------------------
-- STRIPE: leased event claims and durable receipt delivery
-- ---------------------------------------------------------------------------

alter table public.media_views
  add column if not exists idempotency_key text;

create unique index if not exists media_views_idempotency_idx
  on public.media_views (idempotency_key)
  where idempotency_key is not null;

alter table public.stripe_webhook_events
  add column if not exists status text not null default 'processed',
  add column if not exists attempts integer not null default 1,
  add column if not exists first_received_at timestamptz not null default now(),
  add column if not exists last_attempt_at timestamptz,
  add column if not exists claimed_at timestamptz,
  add column if not exists lease_expires_at timestamptz,
  add column if not exists lease_token uuid,
  add column if not exists next_retry_at timestamptz,
  add column if not exists failure_category text,
  add column if not exists last_error_code text,
  add column if not exists terminal_at timestamptz;

alter table public.stripe_webhook_events
  alter column processed_at drop not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'stripe_webhook_events_status_check'
  ) then
    alter table public.stripe_webhook_events
      add constraint stripe_webhook_events_status_check
      check (status in ('processing', 'processed', 'retryable', 'terminal'))
      not valid;
  end if;
end $$;

alter table public.stripe_webhook_events
  validate constraint stripe_webhook_events_status_check;

create index if not exists stripe_webhook_events_retry_idx
  on public.stripe_webhook_events (status, next_retry_at, lease_expires_at);

create or replace function public.claim_stripe_webhook_event(
  p_event_id text,
  p_event_type text,
  p_lease_seconds integer default 300
)
returns table (claimed boolean, claim_token uuid, attempt integer, event_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
  v_attempt integer;
  v_status text;
begin
  if p_lease_seconds < 30 or p_lease_seconds > 1800 then
    raise exception 'invalid webhook lease';
  end if;

  insert into public.stripe_webhook_events(
    event_id, event_type, status, attempts, first_received_at, last_attempt_at,
    claimed_at, lease_expires_at, lease_token, processed_at
  ) values (
    p_event_id, p_event_type, 'processing', 1, clock_timestamp(), clock_timestamp(),
    clock_timestamp(), clock_timestamp() + make_interval(secs => p_lease_seconds),
    v_token, null
  )
  on conflict (event_id) do nothing
  returning attempts, status into v_attempt, v_status;

  if found then
    return query select true, v_token, v_attempt, v_status;
    return;
  end if;

  update public.stripe_webhook_events
     set status = 'processing',
         attempts = attempts + 1,
         last_attempt_at = clock_timestamp(),
         claimed_at = clock_timestamp(),
         lease_expires_at = clock_timestamp() + make_interval(secs => p_lease_seconds),
         lease_token = v_token,
         next_retry_at = null
   where event_id = p_event_id
     and (
       (status = 'retryable'
        and coalesce(next_retry_at, '-infinity') <= clock_timestamp())
       or (status = 'processing' and coalesce(lease_expires_at, '-infinity') <= clock_timestamp())
     )
  returning attempts, status into v_attempt, v_status;

  if found then
    return query select true, v_token, v_attempt, v_status;
  else
    select e.attempts, e.status into v_attempt, v_status
      from public.stripe_webhook_events e where e.event_id = p_event_id;
    return query select false, null::uuid, coalesce(v_attempt, 0), coalesce(v_status, 'processed');
  end if;
end;
$$;

create or replace function public.complete_stripe_webhook_event(
  p_event_id text,
  p_claim_token uuid,
  p_status text,
  p_failure_category text default null,
  p_error_code text default null,
  p_next_retry_at timestamptz default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  if p_status not in ('processed', 'retryable', 'terminal') then
    raise exception 'invalid webhook completion status';
  end if;

  update public.stripe_webhook_events
     set status = p_status,
         processed_at = case when p_status = 'processed' then clock_timestamp() else null end,
         failure_category = p_failure_category,
         last_error_code = p_error_code,
         next_retry_at = case when p_status = 'retryable' then p_next_retry_at else null end,
         terminal_at = case when p_status = 'terminal' then clock_timestamp() else null end,
         lease_expires_at = null,
         lease_token = null
   where event_id = p_event_id
     and status = 'processing'
     and lease_token = p_claim_token;

  return found;
end;
$$;

revoke all on function public.claim_stripe_webhook_event(text, text, integer)
  from public, anon, authenticated;
revoke all on function public.complete_stripe_webhook_event(text, uuid, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function public.claim_stripe_webhook_event(text, text, integer)
  to service_role;
grant execute on function public.complete_stripe_webhook_event(text, uuid, text, text, text, timestamptz)
  to service_role;

alter table public.giving_donations
  add column if not exists stripe_event_created_at timestamptz,
  add column if not exists stripe_object_key text,
  add column if not exists receipt_delivery_status text not null default 'pending',
  add column if not exists receipt_delivery_attempts integer not null default 0,
  add column if not exists receipt_next_retry_at timestamptz,
  add column if not exists receipt_claimed_at timestamptz,
  add column if not exists receipt_claim_token uuid,
  add column if not exists receipt_last_error_code text;

alter table public.giving_subscriptions
  add column if not exists stripe_event_created_at timestamptz;

create unique index if not exists giving_donations_stripe_object_key_idx
  on public.giving_donations (stripe_object_key)
  where stripe_object_key is not null;

update public.giving_donations
   set receipt_delivery_status = 'sent'
 where receipt_email_sent_at is not null
   and receipt_delivery_status <> 'sent';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'giving_donations_receipt_status_check'
  ) then
    alter table public.giving_donations
      add constraint giving_donations_receipt_status_check
      check (receipt_delivery_status in ('pending', 'sending', 'retryable', 'sent', 'terminal'))
      not valid;
  end if;
end $$;

alter table public.giving_donations
  validate constraint giving_donations_receipt_status_check;

create index if not exists giving_donations_receipt_retry_idx
  on public.giving_donations (receipt_delivery_status, receipt_next_retry_at)
  where status = 'succeeded' and donor_email is not null;

create or replace function public.claim_donation_receipt(
  p_donation_id uuid,
  p_lease_seconds integer default 300
)
returns table (claimed boolean, claim_token uuid, attempt integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_token uuid := gen_random_uuid();
  v_attempt integer;
begin
  update public.giving_donations
     set receipt_delivery_status = 'sending',
         receipt_delivery_attempts = receipt_delivery_attempts + 1,
         receipt_claimed_at = clock_timestamp(),
         receipt_claim_token = v_token,
         receipt_next_retry_at = null
   where id = p_donation_id
     and status = 'succeeded'
     and donor_email is not null
     and receipt_email_sent_at is null
     and (
       receipt_delivery_status = 'pending'
       or (receipt_delivery_status = 'retryable'
           and coalesce(receipt_next_retry_at, '-infinity') <= clock_timestamp())
       or (receipt_delivery_status = 'sending'
           and coalesce(receipt_claimed_at, '-infinity')
               <= clock_timestamp() - make_interval(secs => p_lease_seconds))
     )
  returning receipt_delivery_attempts into v_attempt;

  if found then
    return query select true, v_token, v_attempt;
  else
    select d.receipt_delivery_attempts into v_attempt
      from public.giving_donations d where d.id = p_donation_id;
    return query select false, null::uuid, coalesce(v_attempt, 0);
  end if;
end;
$$;

create or replace function public.complete_donation_receipt(
  p_donation_id uuid,
  p_claim_token uuid,
  p_sent boolean,
  p_error_code text default null,
  p_next_retry_at timestamptz default null,
  p_terminal boolean default false
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.giving_donations
     set receipt_delivery_status = case
           when p_sent then 'sent'
           when p_terminal then 'terminal'
           else 'retryable'
         end,
         receipt_email_sent_at = case when p_sent then clock_timestamp() else null end,
         receipt_next_retry_at = case
           when not p_sent and not p_terminal then p_next_retry_at
           else null
         end,
         receipt_last_error_code = case when p_sent then null else p_error_code end,
         receipt_claimed_at = null,
         receipt_claim_token = null,
         updated_at = clock_timestamp()
   where id = p_donation_id
     and receipt_delivery_status = 'sending'
     and receipt_claim_token = p_claim_token;

  return found;
end;
$$;

revoke all on function public.claim_donation_receipt(uuid, integer)
  from public, anon, authenticated;
revoke all on function public.complete_donation_receipt(uuid, uuid, boolean, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function public.claim_donation_receipt(uuid, integer)
  to service_role;
grant execute on function public.complete_donation_receipt(uuid, uuid, boolean, text, timestamptz, boolean)
  to service_role;

notify pgrst, 'reload schema';
