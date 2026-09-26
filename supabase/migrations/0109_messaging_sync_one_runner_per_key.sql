-- Migration 0109
--
-- One chat-sync job per subject at a time. Replaces only the claim function
-- (same signature, so its grants stand) and adds an index; no row changes.
--
-- A group's member sync is a reconcile: read who should be in the channel,
-- read who is, add and remove the difference. Only *pending* jobs were unique
-- per `dedupe_key`, so the in-request sync and the every-minute cron could each
-- run one for the same group at once. The first read memberships before a
-- change, the second after; whichever wrote to Stream last won. A person a
-- leader removed seconds after they joined could be re-added by the stale run
-- and keep reading the group and getting its notifications, with nothing
-- queued to correct it.
--
-- Now a job whose subject already has a run holding a live lease is left
-- pending. It is picked up on the next pass, after that run, and reads the
-- membership as it is then — so the last run is always the freshest.

create index if not exists messaging_sync_jobs_running_dedupe_idx
  on public.messaging_sync_jobs (dedupe_key, lease_expires_at)
  where status = 'running';

create or replace function public.claim_messaging_sync_jobs(
  p_lease_token text,
  p_limit integer default 25,
  p_lease_seconds integer default 120,
  p_now timestamptz default now(),
  p_dedupe_keys text[] default null
)
returns setof public.messaging_sync_jobs
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  with claimable as (
    select j.id
      from public.messaging_sync_jobs j
     where (
             (j.status = 'pending' and j.next_attempt_at <= p_now)
             or (j.status = 'running' and j.lease_expires_at <= p_now)
           )
       and j.attempts < j.max_attempts
       and (p_dedupe_keys is null or j.dedupe_key = any (p_dedupe_keys))
       and not exists (
             select 1
               from public.messaging_sync_jobs r
              where r.dedupe_key = j.dedupe_key
                and r.id <> j.id
                and r.status = 'running'
                and r.lease_expires_at > p_now
           )
     order by j.next_attempt_at, j.id
     limit least(greatest(coalesce(p_limit, 25), 1), 100)
     for update skip locked
  )
  update public.messaging_sync_jobs j
     set status = 'running',
         lease_token = p_lease_token,
         lease_expires_at = p_now + make_interval(secs => greatest(p_lease_seconds, 30)),
         attempts = j.attempts + 1,
         updated_at = p_now
    from claimable
   where j.id = claimable.id
  returning j.*;
end;
$$;
