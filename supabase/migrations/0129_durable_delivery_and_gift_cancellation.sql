-- Delivery progress is a sort cursor, not an audience snapshot. Relationships,
-- preferences and device eligibility continue to be checked on every page.
alter table public.notification_outbox
  add column if not exists audience_after_account_id uuid;
create index if not exists visitor_relationships_broadcast_cursor_idx
  on public.visitor_church_relationships (church_id, account_id)
  where state in ('following', 'joined');

-- Financial cleanup must survive the deletion of an app account. These rows
-- retain only the exact connected-account subscription that must be stopped;
-- no account, donor, contact information or provider payload is stored.
create table if not exists public.giving_recurring_cancellation_jobs (
  id uuid primary key default gen_random_uuid(),
  stripe_account_id text not null check (btrim(stripe_account_id) <> ''),
  stripe_subscription_id text not null check (btrim(stripe_subscription_id) <> ''),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed')),
  attempts integer not null default 0 check (attempts >= 0),
  next_attempt_at timestamptz not null default now(),
  lease_token uuid,
  lease_expires_at timestamptz,
  completed_at timestamptz,
  last_error text,
  check (status <> 'processing' or (lease_token is not null and lease_expires_at is not null)),
  unique (stripe_account_id, stripe_subscription_id)
);

create index if not exists giving_recurring_cancellation_pending_idx
  on public.giving_recurring_cancellation_jobs (next_attempt_at, id)
  where status = 'pending';
create index if not exists giving_recurring_cancellation_lease_idx
  on public.giving_recurring_cancellation_jobs (lease_expires_at, id)
  where status = 'processing';

alter table public.giving_recurring_cancellation_jobs enable row level security;
revoke all on table public.giving_recurring_cancellation_jobs from anon, authenticated;
grant all on table public.giving_recurring_cancellation_jobs to service_role;

create or replace function public.claim_recurring_gift_cancellations(
  p_lease_token uuid,
  p_limit integer default 25
) returns setof public.giving_recurring_cancellation_jobs
language sql volatile security definer
set search_path = public
as $$
  with due as (
    select id
      from public.giving_recurring_cancellation_jobs
     where p_lease_token is not null
       and ((status = 'pending' and next_attempt_at <= now())
         or (status = 'processing' and lease_expires_at <= now()))
     order by next_attempt_at, id
     limit greatest(1, least(coalesce(p_limit, 25), 100))
     for update skip locked
  )
  update public.giving_recurring_cancellation_jobs job
     set status = 'processing',
         attempts = job.attempts + 1,
         lease_token = p_lease_token,
         lease_expires_at = now() + interval '10 minutes'
    from due
   where job.id = due.id
  returning job.*;
$$;

revoke all on function public.claim_recurring_gift_cancellations(uuid, integer)
  from public, anon, authenticated;
grant execute on function public.claim_recurring_gift_cancellations(uuid, integer)
  to service_role;
