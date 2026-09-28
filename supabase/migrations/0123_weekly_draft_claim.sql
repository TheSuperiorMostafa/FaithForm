-- A provider draft is an external side effect. Claim the church/week before
-- creating one so simultaneous cron and manual runs cannot both send it.
-- An uncertain provider result is never retried automatically: the mailbox
-- must be inspected before the claim can be cleared.
create table if not exists public.announcement_weekly_draft_claims (
  church_id uuid not null references public.churches(id) on delete cascade,
  week_start date not null,
  state text not null check (state in ('creating', 'saved', 'uncertain')),
  claim_id uuid not null,
  draft_id text,
  updated_at timestamptz not null default now(),
  primary key (church_id, week_start)
);

alter table public.announcement_weekly_draft_claims enable row level security;
revoke all on public.announcement_weekly_draft_claims from anon, authenticated;
grant select, insert, update, delete on public.announcement_weekly_draft_claims to service_role;

create or replace function public.claim_weekly_announcement_draft(
  p_church_id uuid,
  p_week_start date,
  p_claim_id uuid,
  p_force boolean default false
)
returns text
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_state text;
begin
  if p_church_id is null or p_week_start is null or p_claim_id is null then
    raise exception 'Missing weekly draft claim identifier' using errcode = '22023';
  end if;

  insert into public.announcement_weekly_draft_claims
    (church_id, week_start, state, claim_id)
  values (p_church_id, p_week_start, 'creating', p_claim_id)
  on conflict (church_id, week_start) do update set
    state = 'creating',
    claim_id = excluded.claim_id,
    draft_id = null,
    updated_at = now()
  where p_force and announcement_weekly_draft_claims.state = 'saved'
  returning state into v_state;

  if found then return 'claimed'; end if;

  select state into v_state
  from public.announcement_weekly_draft_claims
  where church_id = p_church_id and week_start = p_week_start;

  if v_state = 'saved' then return 'already_created'; end if;
  return 'needs_review';
end;
$$;

create or replace function public.complete_weekly_announcement_draft(
  p_church_id uuid,
  p_week_start date,
  p_claim_id uuid,
  p_draft_id text
)
returns void
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
begin
  if nullif(trim(p_draft_id), '') is null then
    raise exception 'Missing provider draft identifier' using errcode = '22023';
  end if;

  update public.announcement_weekly_draft_claims set
    state = 'saved',
    draft_id = p_draft_id,
    updated_at = now()
  where church_id = p_church_id
    and week_start = p_week_start
    and claim_id = p_claim_id
    and state in ('creating', 'uncertain');
  if not found then
    raise exception 'Weekly draft claim changed' using errcode = 'P0002';
  end if;

  insert into public.church_settings
    (church_id, last_weekly_announcement_draft_week_start,
     last_weekly_announcement_draft_id, updated_at)
  values (p_church_id, p_week_start, p_draft_id, now())
  on conflict (church_id) do update set
    last_weekly_announcement_draft_week_start = excluded.last_weekly_announcement_draft_week_start,
    last_weekly_announcement_draft_id = excluded.last_weekly_announcement_draft_id,
    updated_at = now();
end;
$$;

create or replace function public.mark_weekly_announcement_draft_uncertain(
  p_church_id uuid,
  p_week_start date,
  p_claim_id uuid
)
returns void
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
begin
  update public.announcement_weekly_draft_claims set
    state = 'uncertain', updated_at = now()
  where church_id = p_church_id
    and week_start = p_week_start
    and claim_id = p_claim_id
    and state = 'creating';
end;
$$;

-- Support may clear an uncertain claim only after checking the mailbox and
-- waiting for the original worker to finish. The claim id prevents clearing
-- a newer attempt by mistake.
create or replace function public.clear_weekly_announcement_draft_claim(
  p_church_id uuid,
  p_week_start date,
  p_claim_id uuid,
  p_mailbox_checked boolean
)
returns boolean
language plpgsql
volatile
security invoker
set search_path = pg_catalog, public
as $$
begin
  if p_mailbox_checked is distinct from true then
    raise exception 'Mailbox review required' using errcode = '22023';
  end if;
  delete from public.announcement_weekly_draft_claims
  where church_id = p_church_id
    and week_start = p_week_start
    and claim_id = p_claim_id
    and state in ('creating', 'uncertain')
    and updated_at < now() - interval '15 minutes';
  return found;
end;
$$;

revoke all on function public.claim_weekly_announcement_draft(uuid, date, uuid, boolean) from public, anon, authenticated;
revoke all on function public.complete_weekly_announcement_draft(uuid, date, uuid, text) from public, anon, authenticated;
revoke all on function public.mark_weekly_announcement_draft_uncertain(uuid, date, uuid) from public, anon, authenticated;
revoke all on function public.clear_weekly_announcement_draft_claim(uuid, date, uuid, boolean) from public, anon, authenticated;
grant execute on function public.claim_weekly_announcement_draft(uuid, date, uuid, boolean) to service_role;
grant execute on function public.complete_weekly_announcement_draft(uuid, date, uuid, text) to service_role;
grant execute on function public.mark_weekly_announcement_draft_uncertain(uuid, date, uuid) to service_role;
grant execute on function public.clear_weekly_announcement_draft_claim(uuid, date, uuid, boolean) to service_role;
