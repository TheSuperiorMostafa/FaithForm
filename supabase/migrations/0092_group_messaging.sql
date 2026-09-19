-- Group messaging: church policy, chat bindings, safety, and the outbox that
-- keeps the chat provider agreeing with FaithForm.
-- Migration 0092 (Prompt 14)
--
-- Additive, and dependent on 0091.
--
-- ## The rule
--
-- FaithForm decides who may talk to whom. The chat provider (Stream) carries
-- the messages. Nothing the provider holds — a channel, a member list, a role —
-- is ever read back as authority. Every change that could make the provider
-- disagree with FaithForm enqueues a *reconcile intent* here, by trigger, in
-- the same transaction as the change; a worker then makes the provider match
-- whatever FaithForm says at the time it runs. That is what makes retries,
-- duplicates and out-of-order delivery harmless.
--
-- ## What is never stored here
--
-- Message bodies. A report keeps a short excerpt of the one message reported,
-- because moderation history must survive the message being removed; nothing
-- else about a conversation's content is copied out of the provider.
--
-- Rollback: drop the triggers, functions and tables created here. No existing
-- row is modified.

-- ---------------------------------------------------------------------------
-- CHURCH POLICY
-- ---------------------------------------------------------------------------
--
-- An absent row means the defaults below. Direct messages default to off: a
-- church turns them on deliberately, as it does every other FaithForm feature
-- that reaches its people.

create table if not exists public.church_messaging_settings (
  church_id uuid primary key references public.churches (id) on delete cascade,
  messaging_enabled boolean not null default true,
  dm_policy text not null default 'disabled'
    constraint church_messaging_dm_policy_check check (
      dm_policy in ('disabled', 'leaders_only', 'leaders_and_members', 'group_members', 'everyone')
    ),
  allow_member_media boolean not null default true,
  allow_member_links boolean not null default true,
  allow_gifs boolean not null default false,
  profanity_filter boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- BINDINGS
-- ---------------------------------------------------------------------------
--
-- Provider identifiers are derived deterministically from FaithForm ids
-- (lib/messaging/ids.ts), so a retried creation lands on the same object.
-- These rows record provisioning state and give inbound events a reverse
-- lookup; they are never an authority on membership.

create table if not exists public.messaging_user_bindings (
  user_id uuid primary key references auth.users (id) on delete cascade,
  chat_user_id text not null unique
    constraint messaging_user_bindings_id_format check (chat_user_id ~ '^ff_[a-z2-7]{26}$'),
  -- What the provider was last told, so an unchanged profile is not re-sent.
  synced_teams text[] not null default '{}',
  synced_profile_hash text,
  synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.group_chat_bindings (
  group_id uuid primary key references public.groups (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  channel_type text not null default 'ff_group'
    constraint group_chat_bindings_type_check check (channel_type = 'ff_group'),
  channel_id text not null unique
    constraint group_chat_bindings_id_format check (channel_id ~ '^grp_[0-9a-f]{32}$'),
  state text not null default 'pending'
    constraint group_chat_bindings_state_check check (state in ('pending', 'active', 'frozen', 'deleted')),
  provisioned_at timestamptz,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messaging_dm_channels (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  channel_id text not null unique
    constraint messaging_dm_channels_id_format check (channel_id ~ '^dm_[a-z2-7]{30}$'),
  -- The pair, ordered, so one conversation exists per pair per church.
  user_low uuid not null references auth.users (id) on delete cascade,
  user_high uuid not null references auth.users (id) on delete cascade,
  created_by uuid references auth.users (id) on delete set null,
  state text not null default 'pending'
    constraint messaging_dm_channels_state_check check (state in ('pending', 'active', 'frozen', 'deleted')),
  frozen_reason text
    constraint messaging_dm_channels_frozen_reason_check check (
      frozen_reason is null or frozen_reason in ('policy', 'blocked', 'restricted', 'left_church')
    ),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint messaging_dm_channels_ordered check (user_low < user_high),
  unique (church_id, user_low, user_high)
);

create index if not exists messaging_dm_channels_user_low_idx
  on public.messaging_dm_channels (user_low, church_id);
create index if not exists messaging_dm_channels_user_high_idx
  on public.messaging_dm_channels (user_high, church_id);

-- ---------------------------------------------------------------------------
-- NOTIFICATION PREFERENCES
-- ---------------------------------------------------------------------------
--
-- The account-wide level for one church. The per-group level lives on
-- group_memberships.notification_level. Effective level: off if this is off,
-- else the group's own level if it set one, else this. Stored here and pushed
-- to the provider — never read back from it.

create table if not exists public.messaging_notification_preferences (
  account_id uuid not null references public.visitor_accounts (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  level text not null default 'all'
    constraint messaging_notification_level_check check (level in ('all', 'mentions', 'off')),
  updated_at timestamptz not null default now(),
  primary key (account_id, church_id)
);

-- ---------------------------------------------------------------------------
-- SAFETY
-- ---------------------------------------------------------------------------

-- A person's own block. Personal, so staff do not read it: moderation works
-- from reports and restrictions, not from who has blocked whom.
create table if not exists public.messaging_blocks (
  blocker_user_id uuid not null references auth.users (id) on delete cascade,
  blocked_user_id uuid not null references auth.users (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (blocker_user_id, blocked_user_id),
  constraint messaging_blocks_not_self check (blocker_user_id <> blocked_user_id)
);

create index if not exists messaging_blocks_blocked_idx
  on public.messaging_blocks (blocked_user_id);

create table if not exists public.messaging_reports (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  report_type text not null
    constraint messaging_reports_type_check check (report_type in ('message', 'user')),

  reporter_user_id uuid references auth.users (id) on delete set null,
  reported_user_id uuid references auth.users (id) on delete set null,
  -- Snapshots that survive an account being deleted, so the history still
  -- reads as a sentence.
  reported_chat_user_id text,
  reporter_label text
    constraint messaging_reports_reporter_label_length check (reporter_label is null or length(reporter_label) <= 120),
  reported_label text
    constraint messaging_reports_reported_label_length check (reported_label is null or length(reported_label) <= 120),

  group_id uuid references public.groups (id) on delete set null,
  dm_channel_id uuid references public.messaging_dm_channels (id) on delete set null,
  channel_cid text
    constraint messaging_reports_cid_length check (channel_cid is null or length(channel_cid) <= 80),
  message_id text
    constraint messaging_reports_message_id_length check (message_id is null or length(message_id) <= 128),
  message_excerpt text
    constraint messaging_reports_excerpt_length check (message_excerpt is null or length(message_excerpt) <= 500),
  message_has_attachments boolean not null default false,
  message_created_at timestamptz,

  reason text not null
    constraint messaging_reports_reason_check check (reason in (
      'spam', 'harassment', 'hate', 'sexual', 'violence', 'self_harm', 'inappropriate', 'other'
    )),
  details text
    constraint messaging_reports_details_length check (details is null or length(details) <= 1000),
  source text not null default 'member'
    constraint messaging_reports_source_check check (source in ('member', 'automatic')),

  status text not null default 'open'
    constraint messaging_reports_status_check check (status in ('open', 'resolved', 'dismissed')),
  resolution text
    constraint messaging_reports_resolution_check check (resolution is null or resolution in (
      'message_removed', 'member_suspended', 'member_removed', 'member_banned', 'no_action'
    )),
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolution_note text
    constraint messaging_reports_resolution_note_length check (resolution_note is null or length(resolution_note) <= 1000),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint messaging_reports_message_has_id
    check (report_type <> 'message' or message_id is not null),
  constraint messaging_reports_resolution_consistent
    check ((status = 'open') = (resolved_at is null))
);

-- One report per person per message: a second tap is the same report.
create unique index if not exists messaging_reports_one_per_message_idx
  on public.messaging_reports (reporter_user_id, message_id)
  where message_id is not null and reporter_user_id is not null;

create index if not exists messaging_reports_church_status_idx
  on public.messaging_reports (church_id, status, created_at desc);

create index if not exists messaging_reports_reported_idx
  on public.messaging_reports (church_id, reported_user_id, created_at desc)
  where reported_user_id is not null;

-- Append-only record of every moderation decision.
create table if not exists public.messaging_moderation_actions (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  report_id uuid references public.messaging_reports (id) on delete set null,
  group_id uuid references public.groups (id) on delete set null,
  target_user_id uuid references auth.users (id) on delete set null,
  target_label text
    constraint messaging_moderation_target_label_length check (target_label is null or length(target_label) <= 120),
  message_id text,
  action text not null
    constraint messaging_moderation_action_check check (action in (
      'message_removed', 'report_dismissed', 'report_resolved', 'user_suspended',
      'suspension_lifted', 'member_removed', 'member_banned', 'ban_lifted', 'note'
    )),
  actor_type text not null
    constraint messaging_moderation_actor_type_check check (actor_type in ('staff', 'leader', 'system')),
  actor_user_id uuid references auth.users (id) on delete set null,
  reason text
    constraint messaging_moderation_reason_length check (reason is null or length(reason) <= 1000),
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists messaging_moderation_actions_church_idx
  on public.messaging_moderation_actions (church_id, created_at desc);

create index if not exists messaging_moderation_actions_report_idx
  on public.messaging_moderation_actions (report_id, created_at)
  where report_id is not null;

-- Suspending someone's messaging in one church. Enforced in the provider as a
-- timed ban in every channel of that church, and by FaithForm refusing to
-- open new conversations.
create table if not exists public.messaging_restrictions (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null default 'suspended'
    constraint messaging_restrictions_kind_check check (kind in ('suspended')),
  reason text
    constraint messaging_restrictions_reason_length check (reason is null or length(reason) <= 500),
  starts_at timestamptz not null default now(),
  -- Null means until someone lifts it.
  ends_at timestamptz,
  lifted_at timestamptz,
  lifted_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint messaging_restrictions_window check (ends_at is null or ends_at > starts_at)
);

create unique index if not exists messaging_restrictions_one_open_idx
  on public.messaging_restrictions (church_id, user_id)
  where lifted_at is null;

-- ---------------------------------------------------------------------------
-- ACTIVITY (COUNTS ONLY)
-- ---------------------------------------------------------------------------

create table if not exists public.group_activity_daily (
  group_id uuid not null references public.groups (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  day date not null,
  message_count integer not null default 0 check (message_count >= 0),
  last_message_at timestamptz,
  primary key (group_id, day)
);

create index if not exists group_activity_daily_church_idx
  on public.group_activity_daily (church_id, day desc);

-- When a staff member last opened a group's messages in the dashboard, so the
-- list can say "new activity" without anyone being a chat member.
create table if not exists public.group_staff_reads (
  user_id uuid not null references auth.users (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  last_viewed_at timestamptz not null default now(),
  primary key (user_id, group_id)
);

-- ---------------------------------------------------------------------------
-- WEBHOOK IDEMPOTENCY
-- ---------------------------------------------------------------------------
--
-- The provider retries with the same X-Webhook-Id. Claiming the id is the
-- first thing the handler does; a duplicate finds it taken and stops.

create table if not exists public.messaging_webhook_receipts (
  webhook_id text primary key
    constraint messaging_webhook_receipts_id_length check (length(webhook_id) between 1 and 128),
  event_type text not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  outcome text
);

create index if not exists messaging_webhook_receipts_received_idx
  on public.messaging_webhook_receipts (received_at);

-- ---------------------------------------------------------------------------
-- THE OUTBOX
-- ---------------------------------------------------------------------------
--
-- A job is an intent to reconcile one subject, not a delta: "make group X's
-- channel members match FaithForm". Two changes to the same subject before the
-- worker runs coalesce into one pending job (the partial unique index), and a
-- change while a job is running queues exactly one more, because the running
-- job may have read the state before it.

create table if not exists public.messaging_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  church_id uuid references public.churches (id) on delete cascade,
  kind text not null
    constraint messaging_sync_jobs_kind_check check (kind in (
      'user.sync', 'user.delete', 'user.devices', 'user.push', 'user.blocks',
      'group.channel', 'group.members',
      'dm.sync', 'channel.delete',
      'church.channels', 'church.restriction'
    )),
  subject text not null
    constraint messaging_sync_jobs_subject_length check (length(subject) between 1 and 200),
  -- Identifiers only. Never a token, never content.
  payload jsonb not null default '{}'::jsonb,
  dedupe_key text not null,
  status text not null default 'pending'
    constraint messaging_sync_jobs_status_check check (status in ('pending', 'running', 'done', 'failed', 'cancelled')),
  attempts integer not null default 0,
  max_attempts integer not null default 12,
  next_attempt_at timestamptz not null default now(),
  lease_token text,
  lease_expires_at timestamptz,
  last_error text
    constraint messaging_sync_jobs_error_length check (last_error is null or length(last_error) <= 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

create unique index if not exists messaging_sync_jobs_pending_dedupe_idx
  on public.messaging_sync_jobs (dedupe_key)
  where status = 'pending';

create index if not exists messaging_sync_jobs_claim_idx
  on public.messaging_sync_jobs (next_attempt_at)
  where status in ('pending', 'running');

create index if not exists messaging_sync_jobs_failed_idx
  on public.messaging_sync_jobs (church_id, updated_at desc)
  where status = 'failed';

create index if not exists messaging_sync_jobs_done_idx
  on public.messaging_sync_jobs (completed_at)
  where status in ('done', 'cancelled');

create or replace function public.enqueue_messaging_sync(
  p_church_id uuid,
  p_kind text,
  p_subject text,
  p_payload jsonb default '{}'::jsonb,
  p_delay_seconds integer default 0
)
returns void
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  -- A job enqueued while its church is being deleted (a cascade reaching a
  -- membership or a binding) keeps no pointer to it. Otherwise the job's own
  -- foreign key would make deleting a church impossible.
  v_church uuid := case
    when p_church_id is not null
         and exists (select 1 from public.churches c where c.id = p_church_id)
      then p_church_id
    else null
  end;
begin
  insert into public.messaging_sync_jobs (
    church_id, kind, subject, payload, dedupe_key, next_attempt_at
  ) values (
    v_church, p_kind, p_subject, coalesce(p_payload, '{}'::jsonb),
    p_kind || ':' || p_subject,
    now() + make_interval(secs => greatest(coalesce(p_delay_seconds, 0), 0))
  )
  on conflict (dedupe_key) where status = 'pending'
  do update
     set payload = public.messaging_sync_jobs.payload || excluded.payload,
         church_id = coalesce(excluded.church_id, public.messaging_sync_jobs.church_id),
         next_attempt_at = least(public.messaging_sync_jobs.next_attempt_at, excluded.next_attempt_at),
         updated_at = now();
end;
$$;

-- Leased, not locked: a worker that dies mid-run has its jobs return when the
-- lease expires. SKIP LOCKED keeps two workers off each other's rows.
--
-- `p_dedupe_keys` narrows a claim to named subjects: a request that has just
-- changed a group can reconcile that group before it responds, so the person
-- who joined sees the conversation at once. The scheduled worker claims
-- anything due; both go through this one function.
create or replace function public.claim_messaging_sync_jobs(
  p_lease_token text,
  p_limit integer default 25,
  p_lease_seconds integer default 120,
  p_now timestamptz default now(),
  p_dedupe_keys text[] default null
)
returns setof public.messaging_sync_jobs
language plpgsql
volatile
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

-- Only the lease holder completes a job. Retries back off exponentially,
-- capped at an hour, and a job out of attempts is `failed` for a person to see.
create or replace function public.complete_messaging_sync_job(
  p_id uuid,
  p_lease_token text,
  p_outcome text,
  p_error text default null,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_updated integer;
begin
  if p_outcome not in ('done', 'retry', 'failed', 'cancelled') then
    raise exception 'invalid outcome' using errcode = 'check_violation';
  end if;

  update public.messaging_sync_jobs j
     set status = case
           when p_outcome = 'done' then 'done'
           when p_outcome = 'cancelled' then 'cancelled'
           when p_outcome = 'failed' then 'failed'
           when j.attempts >= j.max_attempts then 'failed'
           else 'pending'
         end,
         next_attempt_at = case
           when p_outcome = 'retry'
             then p_now + make_interval(secs => least(3600, 15 * power(2, greatest(j.attempts - 1, 0))::integer))
           else j.next_attempt_at
         end,
         last_error = left(p_error, 200),
         lease_token = null,
         lease_expires_at = null,
         completed_at = case when p_outcome in ('done', 'cancelled', 'failed') then p_now else null end,
         updated_at = p_now
   where j.id = p_id
     and j.lease_token = p_lease_token
     and j.status = 'running';

  get diagnostics v_updated = row_count;

  -- A retry that collided with a newer pending job for the same subject is
  -- redundant: the newer one will read current state. Fold it away.
  if v_updated = 0 and p_outcome = 'retry' then
    return false;
  end if;

  return v_updated = 1;
exception
  when unique_violation then
    -- Returning to `pending` collided with a job queued meanwhile for the same
    -- subject. That job supersedes this one.
    update public.messaging_sync_jobs
       set status = 'cancelled', lease_token = null, lease_expires_at = null,
           completed_at = p_now, updated_at = p_now,
           last_error = 'superseded'
     where id = p_id and lease_token = p_lease_token;
    return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- WHAT ENQUEUES A RECONCILE
-- ---------------------------------------------------------------------------

-- The chat user behind an app account, when that person has ever used chat.
create or replace function public.messaging_user_for_account(p_account_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select a.user_id
    from public.visitor_accounts a
    join public.messaging_user_bindings b on b.user_id = a.user_id
   where a.id = p_account_id
$$;

-- Membership changes: the group's members, and the person's push preferences.
create or replace function public.messaging_after_membership_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if tg_op = 'DELETE' then
    -- A membership deleted with its group has no channel left to reconcile;
    -- the binding's own deletion takes the channel with it.
    if exists (select 1 from public.groups g where g.id = old.group_id) then
      perform public.enqueue_messaging_sync(old.church_id, 'group.members', old.group_id::text);
    end if;
    return null;
  end if;

  perform public.enqueue_messaging_sync(new.church_id, 'group.members', new.group_id::text);

  if new.account_id is null then
    return null;
  end if;
  v_user := public.messaging_user_for_account(new.account_id);
  if v_user is null then
    return null;
  end if;

  if tg_op = 'INSERT' then
    perform public.enqueue_messaging_sync(new.church_id, 'user.push', v_user::text);
    perform public.enqueue_messaging_sync(new.church_id, 'dm.sync', 'user:' || v_user::text);
    return null;
  end if;

  if old.notification_level is distinct from new.notification_level
     or old.status is distinct from new.status then
    perform public.enqueue_messaging_sync(new.church_id, 'user.push', v_user::text);
  end if;

  -- Membership decides which conversations are allowed under a group-based
  -- direct message policy, and a youth group's members hold none.
  if old.status is distinct from new.status or old.group_role is distinct from new.group_role then
    perform public.enqueue_messaging_sync(new.church_id, 'dm.sync', 'user:' || v_user::text);
  end if;

  return null;
end;
$$;

drop trigger if exists group_memberships_messaging_sync on public.group_memberships;
create trigger group_memberships_messaging_sync
  after insert or update of status, group_role, account_id, member_id, notification_level, group_id
     or delete on public.group_memberships
  for each row execute function public.messaging_after_membership_change();

-- Group changes the channel reflects: name, artwork, lifecycle, chat settings.
create or replace function public.messaging_after_group_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.enqueue_messaging_sync(new.church_id, 'group.channel', new.id::text);
    return null;
  end if;

  if (new.name, new.cover_image_url, new.status, new.chat_enabled, new.chat_posting,
      new.allow_member_media, new.allow_member_links, new.safety_profile)
     is distinct from
     (old.name, old.cover_image_url, old.status, old.chat_enabled, old.chat_posting,
      old.allow_member_media, old.allow_member_links, old.safety_profile) then
    perform public.enqueue_messaging_sync(new.church_id, 'group.channel', new.id::text);
  end if;

  -- A change of safety profile or lifecycle moves who may hold direct
  -- conversations.
  if old.safety_profile is distinct from new.safety_profile or old.status is distinct from new.status then
    perform public.enqueue_messaging_sync(new.church_id, 'dm.sync', 'church:' || new.church_id::text);
  end if;
  return null;
end;
$$;

drop trigger if exists groups_messaging_sync on public.groups;
create trigger groups_messaging_sync
  after insert or update on public.groups
  for each row execute function public.messaging_after_group_change();

-- Profile changes a chat member can see.
create or replace function public.messaging_after_profile_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if (new.display_name, new.avatar_url, new.status)
     is distinct from (old.display_name, old.avatar_url, old.status)
     and exists (select 1 from public.messaging_user_bindings b where b.user_id = new.user_id) then
    perform public.enqueue_messaging_sync(null, 'user.sync', new.user_id::text);
  end if;
  return null;
end;
$$;

drop trigger if exists visitor_accounts_messaging_sync on public.visitor_accounts;
create trigger visitor_accounts_messaging_sync
  after update of display_name, avatar_url, status on public.visitor_accounts
  for each row execute function public.messaging_after_profile_change();

-- A church relationship decides which tenant a chat user belongs to.
create or replace function public.messaging_after_relationship_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  if tg_op = 'UPDATE' then
    if old.state is not distinct from new.state then
      return null;
    end if;
  end if;

  v_user := public.messaging_user_for_account(new.account_id);
  if v_user is not null then
    perform public.enqueue_messaging_sync(new.church_id, 'user.sync', v_user::text);
    perform public.enqueue_messaging_sync(new.church_id, 'dm.sync', 'user:' || v_user::text);
  end if;
  return null;
end;
$$;

drop trigger if exists visitor_church_relationships_messaging_sync on public.visitor_church_relationships;
create trigger visitor_church_relationships_messaging_sync
  after insert or update of state on public.visitor_church_relationships
  for each row execute function public.messaging_after_relationship_change();

-- Staff access decides whether someone may read a church's group channels
-- from the dashboard.
create or replace function public.messaging_after_staff_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
  v_church uuid;
begin
  if tg_op = 'DELETE' then
    v_user := old.user_id;
    v_church := old.church_id;
  else
    v_user := new.user_id;
    v_church := new.church_id;
  end if;

  if exists (select 1 from public.messaging_user_bindings b where b.user_id = v_user) then
    perform public.enqueue_messaging_sync(v_church, 'user.sync', v_user::text);
  end if;
  return null;
end;
$$;

drop trigger if exists church_users_messaging_sync on public.church_users;
create trigger church_users_messaging_sync
  after insert or update or delete on public.church_users
  for each row execute function public.messaging_after_staff_change();

-- The Groups feature switched on or off for a church.
create or replace function public.messaging_after_feature_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_church uuid;
  v_key text;
begin
  if tg_op = 'DELETE' then
    v_church := old.church_id;
    v_key := old.feature_key;
  else
    v_church := new.church_id;
    v_key := new.feature_key;
  end if;

  if v_key = 'groups' then
    perform public.enqueue_messaging_sync(v_church, 'church.channels', v_church::text);
  end if;
  return null;
end;
$$;

drop trigger if exists church_features_messaging_sync on public.church_features;
create trigger church_features_messaging_sync
  after insert or update or delete on public.church_features
  for each row execute function public.messaging_after_feature_change();

-- Church policy: every channel's configuration, and every conversation's
-- eligibility.
create or replace function public.messaging_after_settings_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_messaging_sync(new.church_id, 'church.channels', new.church_id::text);
  if tg_op = 'INSERT' then
    perform public.enqueue_messaging_sync(new.church_id, 'dm.sync', 'church:' || new.church_id::text);
  elsif old.dm_policy is distinct from new.dm_policy
     or old.messaging_enabled is distinct from new.messaging_enabled then
    perform public.enqueue_messaging_sync(new.church_id, 'dm.sync', 'church:' || new.church_id::text);
  end if;
  return null;
end;
$$;

drop trigger if exists church_messaging_settings_sync on public.church_messaging_settings;
create trigger church_messaging_settings_sync
  after insert or update on public.church_messaging_settings
  for each row execute function public.messaging_after_settings_change();

create or replace function public.messaging_after_block_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_church uuid;
  v_blocker uuid;
begin
  if tg_op = 'DELETE' then
    v_church := old.church_id;
    v_blocker := old.blocker_user_id;
  else
    v_church := new.church_id;
    v_blocker := new.blocker_user_id;
  end if;
  perform public.enqueue_messaging_sync(v_church, 'user.blocks', v_blocker::text);
  perform public.enqueue_messaging_sync(v_church, 'dm.sync', 'user:' || v_blocker::text);
  return null;
end;
$$;

drop trigger if exists messaging_blocks_sync on public.messaging_blocks;
create trigger messaging_blocks_sync
  after insert or delete on public.messaging_blocks
  for each row execute function public.messaging_after_block_change();

create or replace function public.messaging_after_restriction_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_messaging_sync(
    new.church_id, 'church.restriction', new.church_id::text || ':' || new.user_id::text
  );
  return null;
end;
$$;

drop trigger if exists messaging_restrictions_sync on public.messaging_restrictions;
create trigger messaging_restrictions_sync
  after insert or update on public.messaging_restrictions
  for each row execute function public.messaging_after_restriction_change();

-- Devices: mirrored to the provider for chat pushes, but only for people who
-- use chat.
create or replace function public.messaging_after_device_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid;
begin
  v_user := public.messaging_user_for_account(new.account_id);
  if v_user is not null then
    perform public.enqueue_messaging_sync(null, 'user.devices', v_user::text);
  end if;

  -- A device reassigned to another account must leave the previous one.
  if tg_op = 'UPDATE' then
    if old.account_id is distinct from new.account_id then
      v_user := public.messaging_user_for_account(old.account_id);
      if v_user is not null then
        perform public.enqueue_messaging_sync(null, 'user.devices', v_user::text);
      end if;
    end if;
  end if;
  return null;
end;
$$;

drop trigger if exists visitor_device_installations_messaging_sync on public.visitor_device_installations;
create trigger visitor_device_installations_messaging_sync
  after insert or update on public.visitor_device_installations
  for each row execute function public.messaging_after_device_change();

create or replace function public.messaging_after_preference_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := public.messaging_user_for_account(new.account_id);
begin
  if v_user is not null then
    perform public.enqueue_messaging_sync(new.church_id, 'user.push', v_user::text);
  end if;
  return null;
end;
$$;

drop trigger if exists messaging_notification_preferences_sync on public.messaging_notification_preferences;
create trigger messaging_notification_preferences_sync
  after insert or update on public.messaging_notification_preferences
  for each row execute function public.messaging_after_preference_change();

-- An account deleted: its chat identity goes too. The job carries the
-- provider id because the binding row will not exist when it runs.
create or replace function public.messaging_before_binding_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.enqueue_messaging_sync(
    null, 'user.delete', old.chat_user_id,
    jsonb_build_object('chatUserId', old.chat_user_id)
  );
  return old;
end;
$$;

drop trigger if exists messaging_user_bindings_delete on public.messaging_user_bindings;
create trigger messaging_user_bindings_delete
  before delete on public.messaging_user_bindings
  for each row execute function public.messaging_before_binding_delete();

-- A conversation or a group channel whose row goes — an account deleted, a
-- group removed with its church — takes its provider channel with it. The job
-- carries the channel id because the row will not exist when it runs.
create or replace function public.messaging_before_channel_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_type text := case when tg_table_name = 'messaging_dm_channels' then 'ff_dm' else 'ff_group' end;
begin
  perform public.enqueue_messaging_sync(
    old.church_id, 'channel.delete', v_type || ':' || old.channel_id,
    jsonb_build_object('channelType', v_type, 'channelId', old.channel_id)
  );
  return old;
end;
$$;

drop trigger if exists messaging_dm_channels_delete on public.messaging_dm_channels;
create trigger messaging_dm_channels_delete
  before delete on public.messaging_dm_channels
  for each row execute function public.messaging_before_channel_delete();

drop trigger if exists group_chat_bindings_delete on public.group_chat_bindings;
create trigger group_chat_bindings_delete
  before delete on public.group_chat_bindings
  for each row execute function public.messaging_before_channel_delete();

-- ---------------------------------------------------------------------------
-- NAMES, IN BULK
-- ---------------------------------------------------------------------------
--
-- The name a person shows in chat: their app display name, or the name they
-- gave at sign-up. Never an email address — the same rule 0083 applies to
-- People (`app_account_name`). One query for a whole group, so provisioning a
-- channel for two hundred people is not two hundred auth lookups.

create or replace function public.chat_display_names(p_user_ids uuid[])
returns table (user_id uuid, name text, avatar_url text, account_id uuid, account_status text)
language sql
stable
security definer
set search_path = public
as $$
  select
    u.id,
    public.tidy_person_name(left(coalesce(
      public.tidy_person_name(a.display_name),
      public.tidy_person_name(u.raw_user_meta_data ->> 'display_name'),
      public.tidy_person_name(u.raw_user_meta_data ->> 'full_name'),
      public.tidy_person_name(u.raw_user_meta_data ->> 'name')
    ), 120)),
    a.avatar_url,
    a.id,
    a.status
  from auth.users u
  left join public.visitor_accounts a on a.user_id = u.id
  where u.id = any (p_user_ids)
$$;

-- ---------------------------------------------------------------------------
-- ACTIVITY FROM WEBHOOKS
-- ---------------------------------------------------------------------------

-- One message was posted in a group channel: a count goes up. The channel id
-- is resolved through the binding, so an event for a channel FaithForm did not
-- create changes nothing.
create or replace function public.record_group_message_activity(
  p_channel_id text,
  p_created_at timestamptz
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_binding public.group_chat_bindings%rowtype;
  v_group public.groups%rowtype;
begin
  select * into v_binding from public.group_chat_bindings where channel_id = p_channel_id;
  if not found then
    return false;
  end if;

  select * into v_group from public.groups where id = v_binding.group_id;
  if not found then
    return false;
  end if;

  insert into public.group_activity_daily (group_id, church_id, day, message_count, last_message_at)
  values (
    v_group.id, v_group.church_id,
    (p_created_at at time zone coalesce(
      (select c.timezone from public.churches c where c.id = v_group.church_id),
      'America/New_York'
    ))::date,
    1, p_created_at
  )
  on conflict (group_id, day) do update
     set message_count = public.group_activity_daily.message_count + 1,
         last_message_at = greatest(public.group_activity_daily.last_message_at, excluded.last_message_at);

  update public.groups
     set last_activity_at = greatest(coalesce(last_activity_at, p_created_at), p_created_at)
   where id = v_group.id;

  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
--
-- Staff of the church with the Groups feature read policy, reports,
-- moderation history, restrictions, activity counts and their own reads.
-- Bindings, conversations, preferences, blocks, jobs and receipts are for the
-- server alone.

alter table public.church_messaging_settings enable row level security;
alter table public.messaging_user_bindings enable row level security;
alter table public.group_chat_bindings enable row level security;
alter table public.messaging_dm_channels enable row level security;
alter table public.messaging_notification_preferences enable row level security;
alter table public.messaging_blocks enable row level security;
alter table public.messaging_reports enable row level security;
alter table public.messaging_moderation_actions enable row level security;
alter table public.messaging_restrictions enable row level security;
alter table public.group_activity_daily enable row level security;
alter table public.group_staff_reads enable row level security;
alter table public.messaging_webhook_receipts enable row level security;
alter table public.messaging_sync_jobs enable row level security;

revoke all on table public.church_messaging_settings from public, anon, authenticated;
revoke all on table public.messaging_user_bindings from public, anon, authenticated;
revoke all on table public.group_chat_bindings from public, anon, authenticated;
revoke all on table public.messaging_dm_channels from public, anon, authenticated;
revoke all on table public.messaging_notification_preferences from public, anon, authenticated;
revoke all on table public.messaging_blocks from public, anon, authenticated;
revoke all on table public.messaging_reports from public, anon, authenticated;
revoke all on table public.messaging_moderation_actions from public, anon, authenticated;
revoke all on table public.messaging_restrictions from public, anon, authenticated;
revoke all on table public.group_activity_daily from public, anon, authenticated;
revoke all on table public.group_staff_reads from public, anon, authenticated;
revoke all on table public.messaging_webhook_receipts from public, anon, authenticated;
revoke all on table public.messaging_sync_jobs from public, anon, authenticated;

grant select on table
  public.church_messaging_settings,
  public.messaging_reports,
  public.messaging_moderation_actions,
  public.messaging_restrictions,
  public.group_activity_daily,
  public.group_staff_reads
  to authenticated;

grant select, insert, update, delete on table
  public.church_messaging_settings,
  public.messaging_user_bindings,
  public.group_chat_bindings,
  public.messaging_dm_channels,
  public.messaging_notification_preferences,
  public.messaging_blocks,
  public.messaging_reports,
  public.messaging_moderation_actions,
  public.messaging_restrictions,
  public.group_activity_daily,
  public.group_staff_reads,
  public.messaging_webhook_receipts,
  public.messaging_sync_jobs
  to service_role;

create policy church_messaging_settings_select on public.church_messaging_settings
  for select to authenticated using (public.has_groups_access(church_id));
create policy messaging_reports_select on public.messaging_reports
  for select to authenticated using (public.has_groups_access(church_id));
create policy messaging_moderation_actions_select on public.messaging_moderation_actions
  for select to authenticated using (public.has_groups_access(church_id));
create policy messaging_restrictions_select on public.messaging_restrictions
  for select to authenticated using (public.has_groups_access(church_id));
create policy group_activity_daily_select on public.group_activity_daily
  for select to authenticated using (public.has_groups_access(church_id));
create policy group_staff_reads_select on public.group_staff_reads
  for select to authenticated using (user_id = auth.uid() and public.has_groups_access(church_id));

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.enqueue_messaging_sync(uuid, text, text, jsonb, integer)',
    'public.claim_messaging_sync_jobs(text, integer, integer, timestamptz, text[])',
    'public.complete_messaging_sync_job(uuid, text, text, text, timestamptz)',
    'public.messaging_user_for_account(uuid)',
    'public.chat_display_names(uuid[])',
    'public.record_group_message_activity(text, timestamptz)',
    'public.messaging_after_membership_change()',
    'public.messaging_after_group_change()',
    'public.messaging_after_profile_change()',
    'public.messaging_after_relationship_change()',
    'public.messaging_after_staff_change()',
    'public.messaging_after_feature_change()',
    'public.messaging_after_settings_change()',
    'public.messaging_after_block_change()',
    'public.messaging_after_restriction_change()',
    'public.messaging_after_device_change()',
    'public.messaging_after_preference_change()',
    'public.messaging_before_binding_delete()',
    'public.messaging_before_channel_delete()'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
  end loop;
end $$;

grant execute on function public.enqueue_messaging_sync(uuid, text, text, jsonb, integer) to service_role;
grant execute on function public.claim_messaging_sync_jobs(text, integer, integer, timestamptz, text[]) to service_role;
grant execute on function public.complete_messaging_sync_job(uuid, text, text, text, timestamptz) to service_role;
grant execute on function public.messaging_user_for_account(uuid) to service_role;
grant execute on function public.chat_display_names(uuid[]) to service_role;
grant execute on function public.record_group_message_activity(text, timestamptz) to service_role;

notify pgrst, 'reload schema';
