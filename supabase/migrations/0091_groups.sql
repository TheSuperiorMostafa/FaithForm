-- Groups: small groups, classes, teams and ministries — their people, their
-- gatherings, and who came.
-- Migration 0091 (Prompt 14)
--
-- Additive. Every table here is new, and the two existing tables it touches
-- gain nullable columns only:
--
--   * `service_occurrences.group_id` / `group_event_id` — a group gathering is
--     an occurrence of the one attendance authority (0055), not a second ledger.
--   * `attendance_attempts.actor_type` gains `leader`, so the audit says who
--     actually recorded a group's attendance.
--
-- ## Who a group member is
--
-- A membership row can name an app account, a People record, or both. People
-- who join in the app are accounts first; people staff add from People are
-- records first; the People link (0053/0083) is what joins the two, and the
-- triggers at the end of this file keep every membership agreeing with it.
-- Attendance always lands on `members.id`, exactly as every other check-in does.
--
-- ## What nothing in this file does
--
--   * It gives no browser a write path. Every table is service-role written;
--     staff read their own church through RLS, and visitors read nothing
--     directly — the mobile contract is their only door (AD-012).
--   * It changes no existing church's behaviour. No group exists until staff
--     create one, and a gathering's occurrence is invisible to every church-wide
--     check-in picker (see `service_occurrences.group_id` below).
--
-- Rollback: drop the functions and triggers, the tables in reverse dependency
-- order, and the two service_occurrences columns. No pre-existing row is
-- rewritten by this migration.

-- ---------------------------------------------------------------------------
-- ACCESS HELPER
-- ---------------------------------------------------------------------------
--
-- Staff read Groups when their church has the feature and they hold it — the
-- same two switches every other dashboard area uses (0041/0043). A policy
-- helper answers a question about the caller only, so executing it directly
-- reveals nothing the caller's own session could not.

create or replace function public.has_groups_access(target_church_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select public.user_has_feature(target_church_id, 'groups')
$$;

revoke all on function public.has_groups_access(uuid) from public, anon;
grant execute on function public.has_groups_access(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- GROUP TYPES
-- ---------------------------------------------------------------------------
--
-- A church's own categories. Seeded on first use rather than for every church
-- here, so applying this migration writes nothing into an existing account.

create table if not exists public.group_types (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  name text not null
    constraint group_types_name_length check (length(btrim(name)) between 1 and 60),
  -- A key the three clients map to their own icon sets, not an image.
  icon text not null default 'users'
    constraint group_types_icon_check check (icon in (
      'users', 'book', 'sparkles', 'user', 'heart', 'graduation', 'hands',
      'music', 'briefcase', 'school', 'prayer', 'church', 'star', 'coffee',
      'baby', 'globe', 'compass', 'leaf'
    )),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists group_types_church_name_idx
  on public.group_types (church_id, lower(name));

create index if not exists group_types_church_order_idx
  on public.group_types (church_id, sort_order, id)
  where is_active;

-- ---------------------------------------------------------------------------
-- GROUPS
-- ---------------------------------------------------------------------------

create table if not exists public.groups (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  type_id uuid references public.group_types (id) on delete set null,

  name text not null
    constraint groups_name_length check (length(btrim(name)) between 1 and 80),
  description text
    constraint groups_description_length check (description is null or length(description) <= 4000),

  -- Stored under church-covers/<church_id>/groups/<group_id>/ by the server.
  cover_image_path text,
  cover_image_url text
    constraint groups_cover_url_length check (cover_image_url is null or length(cover_image_url) <= 2048),

  -- `deleted` is a tombstone: a group's past gatherings stay in the attendance
  -- authority, and a person's history must still be able to name them.
  status text not null default 'active'
    constraint groups_status_check check (status in ('active', 'archived', 'deleted')),

  -- public: listed in Discover. unlisted: reachable by link. private: invisible
  -- to anyone who is not a member, and indistinguishable from nonexistent.
  visibility text not null default 'public'
    constraint groups_visibility_check check (visibility in ('public', 'unlisted', 'private')),

  enrollment text not null default 'open'
    constraint groups_enrollment_check check (
      enrollment in ('open', 'approval_required', 'invitation_only', 'closed')
    ),

  capacity integer
    constraint groups_capacity_range check (capacity is null or capacity between 1 and 5000),

  campus_id uuid references public.church_campuses (id) on delete set null,

  location_name text
    constraint groups_location_name_length check (location_name is null or length(location_name) <= 200),
  location_address text
    constraint groups_location_address_length check (location_address is null or length(location_address) <= 500),
  -- Small groups meet in homes. A home address is for members unless the
  -- church deliberately says otherwise.
  location_visibility text not null default 'members'
    constraint groups_location_visibility_check check (location_visibility in ('public', 'members')),
  online_meeting_url text
    constraint groups_online_url_check check (
      online_meeting_url is null
      or (online_meeting_url ~* '^https://' and length(online_meeting_url) <= 2048)
    ),

  -- Messaging, per group.
  chat_enabled boolean not null default true,
  -- `leaders`: an announcements-style group where only leaders post.
  chat_posting text not null default 'everyone'
    constraint groups_chat_posting_check check (chat_posting in ('everyone', 'leaders')),
  allow_member_media boolean not null default true,
  allow_member_links boolean not null default true,
  -- Who can see the member list: everyone in the group, or only its leaders.
  member_list_visibility text not null default 'members'
    constraint groups_member_list_visibility_check check (member_list_visibility in ('members', 'leaders')),

  -- `youth`: a context with minors in it. Members of a youth group cannot start
  -- or receive direct messages anywhere in the church (enforced by the DM
  -- policy). An explicit choice staff make — never inferred from anything.
  safety_profile text not null default 'standard'
    constraint groups_safety_profile_check check (safety_profile in ('standard', 'youth')),

  default_notification_level text not null default 'all'
    constraint groups_default_notification_check check (default_notification_level in ('all', 'mentions')),

  -- Maintained by trigger from group_memberships / group_join_requests. Read by
  -- discovery and capacity checks; recomputed rather than incremented, so a
  -- drift heals on the next change.
  member_count integer not null default 0 check (member_count >= 0),
  leader_count integer not null default 0 check (leader_count >= 0),
  pending_request_count integer not null default 0 check (pending_request_count >= 0),

  -- When anyone last posted, from the chat webhook. Counts, never content.
  last_activity_at timestamptz,

  -- Bumped on every change a client renders; drives mobile ETags.
  version integer not null default 1,

  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  archived_at timestamptz,
  archived_by uuid references auth.users (id) on delete set null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint groups_archive_consistent
    check ((status = 'active') = (archived_at is null and deleted_at is null))
);

-- Discovery's exact filter and keyset order.
create index if not exists groups_church_discovery_idx
  on public.groups (church_id, lower(name), id)
  where status = 'active' and visibility = 'public';

create index if not exists groups_church_status_idx
  on public.groups (church_id, status, lower(name), id);

create index if not exists groups_type_idx
  on public.groups (type_id)
  where type_id is not null;

-- ---------------------------------------------------------------------------
-- MEETING SCHEDULES
-- ---------------------------------------------------------------------------
--
-- Machine-readable, like church_service_times, because gatherings are generated
-- from them. Several per group is allowed (Tuesday and Thursday).

create table if not exists public.group_meeting_schedules (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,

  frequency text not null
    constraint group_schedules_frequency_check check (frequency in ('weekly', 'biweekly', 'monthly')),
  -- 0 = Sunday, matching church_service_times and extract(dow).
  day_of_week smallint not null
    constraint group_schedules_dow_check check (day_of_week between 0 and 6),
  -- Monthly only: the 1st–4th, or -1 for the last, of that weekday.
  week_of_month smallint
    constraint group_schedules_wom_check check (week_of_month is null or week_of_month in (1, 2, 3, 4, -1)),
  start_time time not null,
  duration_minutes integer not null default 90
    constraint group_schedules_duration_check check (duration_minutes between 15 and 720),
  timezone text not null,
  -- The first possible date, and the anchor biweekly counts from.
  starts_on date not null default current_date,
  ends_on date,
  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint group_schedules_monthly_week
    check ((frequency = 'monthly') = (week_of_month is not null)),
  constraint group_schedules_range
    check (ends_on is null or ends_on >= starts_on)
);

create index if not exists group_meeting_schedules_group_idx
  on public.group_meeting_schedules (group_id)
  where is_active;

-- The same IANA check campuses use (0053): an invalid zone is refused at write
-- time rather than discovered by whatever renders a gathering in it.
drop trigger if exists group_meeting_schedules_validate_timezone on public.group_meeting_schedules;
create trigger group_meeting_schedules_validate_timezone
  before insert or update on public.group_meeting_schedules
  for each row execute function public.validate_campus_timezone();

-- ---------------------------------------------------------------------------
-- MEMBERSHIPS
-- ---------------------------------------------------------------------------

create table if not exists public.group_memberships (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,

  -- At least one is present (checked below). The before-delete triggers detach
  -- rather than orphan: a deleted app account leaves a People-anchored
  -- membership behind, and a deleted People record leaves an app-anchored one.
  account_id uuid references public.visitor_accounts (id) on delete cascade,
  member_id uuid references public.members (id) on delete cascade,

  -- Which identity created the membership. Decides what survives when the
  -- People link between the two is revoked or moved.
  origin text not null
    constraint group_memberships_origin_check check (origin in ('account', 'people')),

  group_role text not null default 'member'
    constraint group_memberships_role_check check (group_role in ('member', 'leader', 'manager')),

  status text not null default 'active'
    constraint group_memberships_status_check check (status in ('active', 'left', 'removed')),

  -- The account's own choice for this group's messages.
  notification_level text not null default 'default'
    constraint group_memberships_notification_check check (
      notification_level in ('default', 'all', 'mentions', 'muted')
    ),

  source text not null
    constraint group_memberships_source_check check (
      source in ('self', 'approval', 'invitation', 'staff', 'leader')
    ),

  joined_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_reason text
    constraint group_memberships_ended_reason_check check (
      ended_reason is null or ended_reason in (
        'left', 'removed', 'banned', 'left_church', 'group_deleted'
      )
    ),
  ended_by uuid references auth.users (id) on delete set null,
  added_by uuid references auth.users (id) on delete set null,
  role_changed_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint group_memberships_has_subject
    check (account_id is not null or member_id is not null),
  constraint group_memberships_status_consistent
    check ((status = 'active') = (ended_at is null))
);

-- One row per person per group, whichever identity names them.
create unique index if not exists group_memberships_group_account_idx
  on public.group_memberships (group_id, account_id)
  where account_id is not null;

create unique index if not exists group_memberships_group_member_idx
  on public.group_memberships (group_id, member_id)
  where member_id is not null;

-- "My groups".
create index if not exists group_memberships_account_idx
  on public.group_memberships (account_id, status)
  where account_id is not null;

create index if not exists group_memberships_member_idx
  on public.group_memberships (member_id, status)
  where member_id is not null;

-- Rosters, leaders, counts.
create index if not exists group_memberships_group_active_idx
  on public.group_memberships (group_id, group_role)
  where status = 'active';

create index if not exists group_memberships_church_joined_idx
  on public.group_memberships (church_id, joined_at desc);

-- ---------------------------------------------------------------------------
-- JOIN REQUESTS, INVITATIONS, BANS
-- ---------------------------------------------------------------------------

create table if not exists public.group_join_requests (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  account_id uuid not null references public.visitor_accounts (id) on delete cascade,

  message text
    constraint group_join_requests_message_length check (message is null or length(message) <= 500),

  status text not null default 'pending'
    constraint group_join_requests_status_check check (
      status in ('pending', 'approved', 'declined', 'cancelled')
    ),
  decided_by uuid references auth.users (id) on delete set null,
  decided_at timestamptz,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- One open request per person per group; a second tap joins the first.
create unique index if not exists group_join_requests_one_pending_idx
  on public.group_join_requests (group_id, account_id)
  where status = 'pending';

create index if not exists group_join_requests_group_idx
  on public.group_join_requests (group_id, status, created_at desc);

create index if not exists group_join_requests_church_pending_idx
  on public.group_join_requests (church_id, created_at desc)
  where status = 'pending';

-- Shareable links. Only the SHA-256 of the token is stored, exactly as
-- visitor_invitations does: a leaked backup yields no working link.
create table if not exists public.group_invitations (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  token_hash text not null unique,
  max_uses integer not null default 50
    constraint group_invitations_max_uses check (max_uses between 1 and 1000),
  used_count integer not null default 0 check (used_count >= 0),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists group_invitations_group_idx
  on public.group_invitations (group_id, created_at desc);

create table if not exists public.group_bans (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  account_id uuid references public.visitor_accounts (id) on delete cascade,
  member_id uuid references public.members (id) on delete cascade,
  reason text
    constraint group_bans_reason_length check (reason is null or length(reason) <= 500),
  banned_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  lifted_at timestamptz,
  lifted_by uuid references auth.users (id) on delete set null,
  constraint group_bans_has_subject check (account_id is not null or member_id is not null)
);

create unique index if not exists group_bans_active_account_idx
  on public.group_bans (group_id, account_id)
  where lifted_at is null and account_id is not null;

create unique index if not exists group_bans_active_member_idx
  on public.group_bans (group_id, member_id)
  where lifted_at is null and member_id is not null;

-- ---------------------------------------------------------------------------
-- GATHERINGS
-- ---------------------------------------------------------------------------
--
-- What a group does together: generated from its schedule or created by a
-- leader. Location fields override the group's own; null means "where the
-- group usually meets".

create table if not exists public.group_events (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  schedule_id uuid references public.group_meeting_schedules (id) on delete set null,

  title text not null
    constraint group_events_title_length check (length(btrim(title)) between 1 and 120),
  description text
    constraint group_events_description_length check (description is null or length(description) <= 4000),

  starts_at timestamptz not null,
  ends_at timestamptz not null,
  timezone text not null,

  location_name text
    constraint group_events_location_name_length check (location_name is null or length(location_name) <= 200),
  location_address text
    constraint group_events_location_address_length check (location_address is null or length(location_address) <= 500),
  online_meeting_url text
    constraint group_events_online_url_check check (
      online_meeting_url is null
      or (online_meeting_url ~* '^https://' and length(online_meeting_url) <= 2048)
    ),

  status text not null default 'scheduled'
    constraint group_events_status_check check (status in ('scheduled', 'cancelled')),

  -- Generated from a schedule: identity is (schedule, the slot it filled). A
  -- leader's edit marks it modified so regeneration leaves it alone.
  is_generated boolean not null default false,
  is_modified boolean not null default false,
  generated_for timestamptz,

  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  cancellation_reason text
    constraint group_events_cancellation_length check (cancellation_reason is null or length(cancellation_reason) <= 300),

  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  version integer not null default 1,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint group_events_time_sane
    check (ends_at > starts_at and ends_at - starts_at <= interval '24 hours'),
  constraint group_events_generated_identity
    check (not is_generated or generated_for is not null),
  constraint group_events_cancel_consistent
    check ((status = 'cancelled') = (cancelled_at is not null))
);

create unique index if not exists group_events_generated_idx
  on public.group_events (schedule_id, generated_for)
  where schedule_id is not null and generated_for is not null;

create index if not exists group_events_group_start_idx
  on public.group_events (group_id, starts_at, id);

create index if not exists group_events_church_start_idx
  on public.group_events (church_id, starts_at);

drop trigger if exists group_events_validate_timezone on public.group_events;
create trigger group_events_validate_timezone
  before insert or update on public.group_events
  for each row execute function public.validate_campus_timezone();

create table if not exists public.group_event_rsvps (
  event_id uuid not null references public.group_events (id) on delete cascade,
  account_id uuid not null references public.visitor_accounts (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  response text not null
    constraint group_event_rsvps_response_check check (response in ('going', 'maybe', 'not_going')),
  updated_at timestamptz not null default now(),
  primary key (event_id, account_id)
);

create index if not exists group_event_rsvps_group_idx
  on public.group_event_rsvps (group_id, event_id);

-- ---------------------------------------------------------------------------
-- THE ATTENDANCE AUTHORITY, FOR GATHERINGS
-- ---------------------------------------------------------------------------
--
-- A gathering's attendance is an ordinary occurrence of 0055's authority.
-- `group_id` marks it, and every church-wide picker (the geofence, QR, kiosk
-- and Services paths) excludes it — so a Wednesday small group can never catch
-- a Sunday check-in, and church service reports keep meaning services.

alter table public.service_occurrences
  add column if not exists group_id uuid references public.groups (id) on delete cascade,
  add column if not exists group_event_id uuid references public.group_events (id) on delete set null;

create index if not exists service_occurrences_group_idx
  on public.service_occurrences (group_id, starts_at_utc desc)
  where group_id is not null;

create unique index if not exists service_occurrences_group_event_idx
  on public.service_occurrences (group_event_id)
  where group_event_id is not null;

-- A new generation source, by the definition of the check rather than a
-- guessed constraint name (the same technique 0083 uses).
do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.service_occurrences'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ~ 'generation_source'
  loop
    execute format('alter table public.service_occurrences drop constraint %I', v_constraint);
  end loop;
end $$;

alter table public.service_occurrences
  add constraint service_occurrences_generation_source_check
  check (generation_source in ('schedule', 'manual', 'legacy_backfill', 'group'));

-- Two groups can meet at the same hour under the same name. Their identity is
-- the gathering, not the label, so group occurrences leave the manual index
-- and are identified by `service_occurrences_group_event_idx` instead.
drop index if exists public.service_occurrences_manual_idx;
create unique index service_occurrences_manual_idx
  on public.service_occurrences (
    church_id,
    coalesce(campus_id, '00000000-0000-0000-0000-000000000000'::uuid),
    starts_at_utc,
    label
  )
  where service_time_id is null
    and generation_source <> 'schedule'
    and calendar_event_id is null
    and group_id is null;

-- Who recorded it. A group leader is not church staff, and the attempt audit
-- should say which it was.
do $$
declare
  v_constraint text;
begin
  for v_constraint in
    select c.conname
      from pg_constraint c
     where c.conrelid = 'public.attendance_attempts'::regclass
       and c.contype = 'c'
       and pg_get_constraintdef(c.oid) ~ 'actor_type'
  loop
    execute format('alter table public.attendance_attempts drop constraint %I', v_constraint);
  end loop;
end $$;

alter table public.attendance_attempts
  add constraint attendance_attempts_actor_type_check
  check (actor_type in ('visitor', 'staff', 'kiosk', 'system', 'leader'));

-- One row per gathering whose attendance was taken: the roster as it stood,
-- and the headcount of guests who are not in People. Present members are the
-- occurrence's active counted facts, never a copy here.
create table if not exists public.group_attendance_records (
  event_id uuid primary key references public.group_events (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  occurrence_id uuid not null references public.service_occurrences (id) on delete cascade,

  -- The People records who were members when attendance was taken, so a later
  -- departure does not rewrite who was absent.
  roster_member_ids uuid[] not null default '{}',
  -- Members with no People record yet (their church has not confirmed who they
  -- are). Reported rather than silently dropped.
  unrecorded_count integer not null default 0 check (unrecorded_count >= 0),

  present_count integer not null default 0 check (present_count >= 0),
  absent_count integer not null default 0 check (absent_count >= 0),
  guest_count integer not null default 0
    constraint group_attendance_guest_range check (guest_count between 0 and 1000),
  first_time_guest_count integer not null default 0
    constraint group_attendance_first_time_range check (first_time_guest_count between 0 and 1000),
  notes text
    constraint group_attendance_notes_length check (notes is null or length(notes) <= 1000),

  recorded_by uuid references auth.users (id) on delete set null,
  recorded_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint group_attendance_first_time_within_guests
    check (first_time_guest_count <= guest_count)
);

create index if not exists group_attendance_records_group_idx
  on public.group_attendance_records (group_id, recorded_at desc);

create index if not exists group_attendance_records_church_idx
  on public.group_attendance_records (church_id, recorded_at desc);

-- ---------------------------------------------------------------------------
-- AUDIT
-- ---------------------------------------------------------------------------
--
-- Append-only, like every other audit in this schema. Never updated, never
-- deleted except by the church itself being deleted.

create table if not exists public.group_audit_events (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  group_id uuid references public.groups (id) on delete cascade,
  membership_id uuid references public.group_memberships (id) on delete set null,
  subject_account_id uuid references public.visitor_accounts (id) on delete set null,
  subject_member_id uuid references public.members (id) on delete set null,
  action text not null,
  actor_type text not null
    constraint group_audit_actor_type_check check (actor_type in ('member', 'leader', 'staff', 'system')),
  actor_user_id uuid references auth.users (id) on delete set null,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists group_audit_events_church_idx
  on public.group_audit_events (church_id, created_at desc);

create index if not exists group_audit_events_group_idx
  on public.group_audit_events (group_id, created_at desc)
  where group_id is not null;

create or replace function public.log_group_event(
  p_church_id uuid,
  p_group_id uuid,
  p_action text,
  p_actor_type text,
  p_actor_user_id uuid,
  p_membership_id uuid default null,
  p_account_id uuid default null,
  p_member_id uuid default null,
  p_detail jsonb default '{}'::jsonb
)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  insert into public.group_audit_events (
    church_id, group_id, membership_id, subject_account_id, subject_member_id,
    action, actor_type, actor_user_id, detail
  ) values (
    p_church_id, p_group_id, p_membership_id, p_account_id, p_member_id,
    p_action, p_actor_type, p_actor_user_id, coalesce(p_detail, '{}'::jsonb)
  )
$$;

-- ---------------------------------------------------------------------------
-- DERIVED COUNTS AND VERSIONS
-- ---------------------------------------------------------------------------

create or replace function public.refresh_group_counts(p_group_id uuid)
returns void
language sql
volatile
security definer
set search_path = public
as $$
  update public.groups g
     set member_count = (
           select count(*) from public.group_memberships m
            where m.group_id = g.id and m.status = 'active'
         ),
         leader_count = (
           select count(*) from public.group_memberships m
            where m.group_id = g.id and m.status = 'active' and m.group_role = 'leader'
         ),
         pending_request_count = (
           select count(*) from public.group_join_requests r
            where r.group_id = g.id and r.status = 'pending'
         )
   where g.id = p_group_id
$$;

create or replace function public.group_counts_after_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.refresh_group_counts(new.group_id);
  elsif tg_op = 'UPDATE' then
    perform public.refresh_group_counts(new.group_id);
    if old.group_id <> new.group_id then
      perform public.refresh_group_counts(old.group_id);
    end if;
  else
    perform public.refresh_group_counts(old.group_id);
  end if;
  return null;
end;
$$;

drop trigger if exists group_memberships_counts on public.group_memberships;
create trigger group_memberships_counts
  after insert or update of status, group_role, group_id or delete on public.group_memberships
  for each row execute function public.group_counts_after_change();

drop trigger if exists group_join_requests_counts on public.group_join_requests;
create trigger group_join_requests_counts
  after insert or update of status or delete on public.group_join_requests
  for each row execute function public.group_counts_after_change();

-- Every change a client renders moves the version; bookkeeping does not.
create or replace function public.bump_group_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.name, new.description, new.cover_image_url, new.status, new.visibility,
      new.enrollment, new.capacity, new.campus_id, new.type_id, new.location_name,
      new.location_address, new.location_visibility, new.online_meeting_url,
      new.chat_enabled, new.chat_posting, new.allow_member_media,
      new.allow_member_links, new.member_list_visibility, new.safety_profile,
      new.member_count, new.leader_count)
     is distinct from
     (old.name, old.description, old.cover_image_url, old.status, old.visibility,
      old.enrollment, old.capacity, old.campus_id, old.type_id, old.location_name,
      old.location_address, old.location_visibility, old.online_meeting_url,
      old.chat_enabled, old.chat_posting, old.allow_member_media,
      old.allow_member_links, old.member_list_visibility, old.safety_profile,
      old.member_count, old.leader_count)
  then
    new.version := old.version + 1;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists groups_bump_version on public.groups;
create trigger groups_bump_version
  before update on public.groups
  for each row execute function public.bump_group_version();

create or replace function public.bump_group_event_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.title, new.description, new.starts_at, new.ends_at, new.timezone,
      new.location_name, new.location_address, new.online_meeting_url, new.status)
     is distinct from
     (old.title, old.description, old.starts_at, old.ends_at, old.timezone,
      old.location_name, old.location_address, old.online_meeting_url, old.status)
  then
    new.version := old.version + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists group_events_bump_version on public.group_events;
create trigger group_events_bump_version
  before update on public.group_events
  for each row execute function public.bump_group_event_version();

-- ---------------------------------------------------------------------------
-- WHO SOMEONE IS, IN ONE CHURCH
-- ---------------------------------------------------------------------------

-- The People record an account is verifiably linked to at this church, if any.
create or replace function public.linked_member_id(p_account_id uuid, p_church_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.member_id
    from public.visitor_people_links l
   where l.account_id = p_account_id
     and l.church_id = p_church_id
     and l.is_active
   limit 1
$$;

-- The account a People record is verifiably linked to, if any.
create or replace function public.linked_account_id(p_member_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select l.account_id
    from public.visitor_people_links l
   where l.member_id = p_member_id
     and l.is_active
   limit 1
$$;

-- An account's membership of a group, by either identity.
create or replace function public.group_membership_for_account(p_group_id uuid, p_account_id uuid)
returns public.group_memberships
language sql
stable
security definer
set search_path = public
as $$
  select m.*
    from public.group_memberships m
    join public.groups g on g.id = m.group_id
   where m.group_id = p_group_id
     and (
       m.account_id = p_account_id
       or (m.account_id is null
           and m.member_id = public.linked_member_id(p_account_id, g.church_id))
     )
   order by (m.account_id is not null) desc
   limit 1
$$;

create or replace function public.group_role_rank(p_role text)
returns integer
language sql
immutable
set search_path = public
as $$
  select case p_role when 'manager' then 3 when 'leader' then 2 when 'member' then 1 else 0 end
$$;

-- ---------------------------------------------------------------------------
-- JOINING A GROUP MAKES YOU ONE OF THE CHURCH'S PEOPLE
-- ---------------------------------------------------------------------------
--
-- 0083's decision, extended to groups: attendance lands on `members.id`, so a
-- group member needs a People record. The rule is 0083's exactly — a record is
-- created from the account's *name* only when nobody in People has that name;
-- otherwise a claim opens and a person decides. Nothing links an account to an
-- existing People record without staff naming it, and email and phone decide
-- nothing.

create or replace function public.connect_group_member_people(
  p_account_id uuid,
  p_church_id uuid,
  p_actor_user_id uuid default null
)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_state text;
  v_status text;
  v_name text;
  v_first text;
  v_last text;
  v_member_id uuid;
  v_link_id uuid;
  v_claim_id uuid;
  v_actor_type text := case when p_actor_user_id is null then 'system' else 'staff' end;
begin
  if p_account_id is null or p_church_id is null then
    return 'not_a_group_member';
  end if;

  -- The same lock 0083 takes, so a church join and a group join racing for the
  -- same person create one record between them.
  perform pg_advisory_xact_lock(
    hashtextextended('connect_app_member:' || p_account_id::text || ':' || p_church_id::text, 0)
  );

  select r.state into v_state
    from public.visitor_church_relationships r
   where r.account_id = p_account_id
     and r.church_id = p_church_id;

  if v_state is null or v_state not in ('following', 'pending', 'joined') then
    return 'not_a_group_member';
  end if;

  if not exists (
    select 1 from public.group_memberships m
     where m.account_id = p_account_id
       and m.church_id = p_church_id
       and m.status = 'active'
  ) then
    return 'not_a_group_member';
  end if;

  select a.status into v_status from public.visitor_accounts a where a.id = p_account_id;
  if v_status is distinct from 'active' then
    return 'account_inactive';
  end if;

  if public.linked_member_id(p_account_id, p_church_id) is not null then
    return 'already_linked';
  end if;

  if exists (
    select 1 from public.visitor_people_claims c
     where c.account_id = p_account_id
       and c.church_id = p_church_id
       and c.status in ('pending', 'disputed')
  ) then
    return 'awaiting_staff';
  end if;

  v_name := public.app_account_name(p_account_id);
  if v_name is not null then
    select s.first_name, s.last_name into v_first, v_last
      from public.split_person_name(v_name) s;
  end if;

  if v_name is null or exists (
    select 1 from public.members m
     where m.church_id = p_church_id
       and public.person_name_key(m.first_name, m.last_name) = lower(v_name)
  ) then
    insert into public.visitor_people_claims (
      account_id, church_id, status, source, claimed_first_name, claimed_last_name
    ) values (
      p_account_id, p_church_id, 'pending', 'join', v_first, nullif(v_last, '')
    )
    returning id into v_claim_id;

    insert into public.visitor_people_link_events (
      church_id, account_id, claim_id, action, to_status, actor_type, actor_user_id, note
    ) values (
      p_church_id, p_account_id, v_claim_id, 'claim_opened_on_group_join', 'pending',
      v_actor_type, p_actor_user_id,
      case
        when v_name is null then 'The app account has no name.'
        else 'Someone in People already has this name.'
      end
    );

    return 'awaiting_staff';
  end if;

  insert into public.members (church_id, first_name, last_name, is_active, source)
  values (p_church_id, v_first, coalesce(v_last, ''), true, 'app')
  returning id into v_member_id;

  insert into public.visitor_people_links (
    account_id, church_id, member_id, is_active, linked_at, linked_by
  ) values (
    p_account_id, p_church_id, v_member_id, true, now(), p_actor_user_id
  )
  returning id into v_link_id;

  insert into public.visitor_people_link_events (
    church_id, account_id, link_id, member_id, action, to_status, actor_type, actor_user_id
  ) values (
    p_church_id, p_account_id, v_link_id, v_member_id, 'member_created_on_group_join', 'active',
    v_actor_type, p_actor_user_id
  );

  update public.visitor_accounts
     set authorization_version = authorization_version + 1,
         updated_at = now()
   where id = p_account_id;

  return 'linked';
end;
$$;

-- ---------------------------------------------------------------------------
-- KEEPING MEMBERSHIPS IN STEP WITH THE PEOPLE LINK
-- ---------------------------------------------------------------------------

-- A link became active: every membership that names either side gains the
-- other, and a person who was in a group twice — once as their account, once
-- as their People record — becomes one membership.
create or replace function public.reconcile_group_membership_link(
  p_account_id uuid,
  p_member_id uuid,
  p_church_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_by_account public.group_memberships%rowtype;
  v_by_member public.group_memberships%rowtype;
begin
  for v_group in
    select distinct m.group_id
      from public.group_memberships m
     where m.church_id = p_church_id
       and (m.account_id = p_account_id or m.member_id = p_member_id)
  loop
    v_by_account := null;
    v_by_member := null;

    select * into v_by_account from public.group_memberships
     where group_id = v_group and account_id = p_account_id
     for update;
    select * into v_by_member from public.group_memberships
     where group_id = v_group and member_id = p_member_id
     for update;

    if v_by_account.id is not null and v_by_member.id is not null
       and v_by_account.id <> v_by_member.id then
      -- Two rows for one person. Keep the account's (it carries their chat and
      -- preferences); fold in the stronger role and the earlier join.
      delete from public.group_memberships where id = v_by_member.id;

      update public.group_memberships
         set member_id = p_member_id,
             group_role = case
               when public.group_role_rank(v_by_member.group_role) > public.group_role_rank(v_by_account.group_role)
                 then v_by_member.group_role
               else v_by_account.group_role
             end,
             status = case
               when v_by_account.status = 'active' or v_by_member.status = 'active' then 'active'
               else v_by_account.status
             end,
             ended_at = case
               when v_by_account.status = 'active' or v_by_member.status = 'active' then null
               else v_by_account.ended_at
             end,
             ended_reason = case
               when v_by_account.status = 'active' or v_by_member.status = 'active' then null
               else v_by_account.ended_reason
             end,
             joined_at = least(v_by_account.joined_at, v_by_member.joined_at),
             updated_at = now()
       where id = v_by_account.id;

      perform public.log_group_event(
        p_church_id, v_group, 'membership_merged', 'system', null,
        v_by_account.id, p_account_id, p_member_id, '{}'::jsonb
      );
    elsif v_by_account.id is not null
          and v_by_account.member_id is distinct from p_member_id then
      update public.group_memberships
         set member_id = p_member_id, updated_at = now()
       where id = v_by_account.id;
      perform public.log_group_event(
        p_church_id, v_group, 'membership_linked', 'system', null,
        v_by_account.id, p_account_id, p_member_id, '{}'::jsonb
      );
    elsif v_by_member.id is not null
          and v_by_member.account_id is distinct from p_account_id then
      update public.group_memberships
         set account_id = p_account_id, updated_at = now()
       where id = v_by_member.id;
      perform public.log_group_event(
        p_church_id, v_group, 'membership_linked', 'system', null,
        v_by_member.id, p_account_id, p_member_id, '{}'::jsonb
      );
    end if;
  end loop;
end;
$$;

-- A link was revoked or moved: each membership keeps the identity it was
-- created with and lets go of the other.
create or replace function public.detach_group_membership_link(
  p_account_id uuid,
  p_member_id uuid,
  p_church_id uuid
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.group_memberships
     set member_id = null, updated_at = now()
   where church_id = p_church_id
     and account_id = p_account_id
     and member_id = p_member_id
     and origin = 'account';

  update public.group_memberships
     set account_id = null, updated_at = now()
   where church_id = p_church_id
     and account_id = p_account_id
     and member_id = p_member_id
     and origin = 'people';
end;
$$;

create or replace function public.group_memberships_follow_people_link()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    if new.is_active then
      perform public.reconcile_group_membership_link(new.account_id, new.member_id, new.church_id);
    end if;
    return null;
  end if;

  -- UPDATE
  if old.is_active
     and (not new.is_active or old.member_id <> new.member_id or old.account_id <> new.account_id) then
    perform public.detach_group_membership_link(old.account_id, old.member_id, old.church_id);
  end if;

  if new.is_active
     and (not old.is_active or old.member_id <> new.member_id or old.account_id <> new.account_id) then
    perform public.reconcile_group_membership_link(new.account_id, new.member_id, new.church_id);
  end if;

  return null;
end;
$$;

drop trigger if exists visitor_people_links_group_memberships on public.visitor_people_links;
create trigger visitor_people_links_group_memberships
  after insert or update of is_active, member_id, account_id on public.visitor_people_links
  for each row execute function public.group_memberships_follow_people_link();

-- Deleting an app account or a People record detaches rather than orphans.
create or replace function public.group_memberships_detach_account()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.group_memberships
     set account_id = null, updated_at = now()
   where account_id = old.id
     and member_id is not null;
  -- A ban anchored to a People record is the church's decision about that
  -- person, and outlives the app account like the membership does.
  update public.group_bans
     set account_id = null
   where account_id = old.id
     and member_id is not null;
  return old;
end;
$$;

drop trigger if exists visitor_accounts_detach_group_memberships on public.visitor_accounts;
create trigger visitor_accounts_detach_group_memberships
  before delete on public.visitor_accounts
  for each row execute function public.group_memberships_detach_account();

create or replace function public.group_memberships_detach_member()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.group_memberships
     set member_id = null, updated_at = now()
   where member_id = old.id
     and account_id is not null;
  return old;
end;
$$;

drop trigger if exists members_detach_group_memberships on public.members;
create trigger members_detach_group_memberships
  before delete on public.members
  for each row execute function public.group_memberships_detach_member();

-- Leaving the church, or being blocked by it, ends that account's part in
-- every group there. People-anchored memberships keep the person (staff put
-- them there) but let go of the account, which is what revokes chat.
create or replace function public.group_memberships_follow_church_relationship()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row record;
begin
  if tg_op = 'UPDATE' then
    if old.state is not distinct from new.state then
      return null;
    end if;
  end if;

  if new.state in ('left', 'blocked') then
    for v_row in
      select m.id, m.group_id, m.member_id
        from public.group_memberships m
       where m.account_id = new.account_id
         and m.church_id = new.church_id
         and m.status = 'active'
         and m.origin = 'account'
    loop
      update public.group_memberships
         set status = 'removed', ended_at = now(), ended_reason = 'left_church', updated_at = now()
       where id = v_row.id;
      perform public.log_group_event(
        new.church_id, v_row.group_id, 'member_removed', 'system', null,
        v_row.id, new.account_id, v_row.member_id,
        jsonb_build_object('reason', 'left_church', 'relationship', new.state)
      );
    end loop;

    update public.group_memberships
       set account_id = null, updated_at = now()
     where account_id = new.account_id
       and church_id = new.church_id
       and origin = 'people';

    update public.group_join_requests
       set status = 'cancelled', updated_at = now()
     where account_id = new.account_id
       and church_id = new.church_id
       and status = 'pending';
  end if;
  return null;
end;
$$;

drop trigger if exists visitor_church_relationships_group_memberships on public.visitor_church_relationships;
create trigger visitor_church_relationships_group_memberships
  after insert or update of state on public.visitor_church_relationships
  for each row execute function public.group_memberships_follow_church_relationship();

-- ---------------------------------------------------------------------------
-- THE COMMANDS
-- ---------------------------------------------------------------------------
--
-- Every change to who is in a group runs through one of these. Each locks the
-- group row first, so capacity, counts and the membership write are decided
-- together: two people taking the last seat race into the lock, and exactly
-- one of them gets it.
--
-- Authorization of the *actor* (is this person a leader of this group, does
-- this staff member hold the Groups feature) is the caller's, and is asserted
-- by the TypeScript services and their tests. What these functions guarantee
-- is the tenant: every id is checked against the group's own church, so an id
-- from another church resolves to nothing.

-- Is this account allowed to be in groups at this church at all?
create or replace function public.group_account_can_participate(p_account_id uuid, p_church_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.visitor_accounts a
      join public.visitor_church_relationships r
        on r.account_id = a.id and r.church_id = p_church_id
     where a.id = p_account_id
       and a.status = 'active'
       and r.state in ('following', 'pending', 'joined')
  )
$$;

create or replace function public.group_is_banned(p_group_id uuid, p_account_id uuid, p_member_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.group_bans b
     where b.group_id = p_group_id
       and b.lifted_at is null
       and (
         (p_account_id is not null and b.account_id = p_account_id)
         or (p_member_id is not null and b.member_id = p_member_id)
       )
  )
$$;

-- Makes an account an active member. The caller holds the group lock.
create or replace function public.group_admit_account(
  p_group public.groups,
  p_account_id uuid,
  p_source text,
  p_actor_user_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_member_id uuid := public.linked_member_id(p_account_id, p_group.church_id);
  v_existing public.group_memberships%rowtype;
  v_id uuid;
begin
  select * into v_existing
    from public.group_memberships m
   where m.group_id = p_group.id
     and (m.account_id = p_account_id
          or (v_member_id is not null and m.member_id = v_member_id))
   order by (m.account_id = p_account_id) desc
   limit 1
   for update;

  if v_existing.id is not null then
    update public.group_memberships
       set account_id = p_account_id,
           member_id = coalesce(member_id, v_member_id),
           status = 'active',
           -- A returning member starts as a member again: a role is given,
           -- never remembered across a departure.
           group_role = case when status = 'active' then group_role else 'member' end,
           joined_at = case when status = 'active' then joined_at else now() end,
           ended_at = null,
           ended_reason = null,
           ended_by = null,
           source = case when status = 'active' then source else p_source end,
           added_by = case when status = 'active' then added_by else p_actor_user_id end,
           notification_level = case when status = 'active' then notification_level else 'default' end,
           updated_at = now()
     where id = v_existing.id
    returning id into v_id;
  else
    insert into public.group_memberships (
      church_id, group_id, account_id, member_id, origin, group_role, status,
      source, added_by
    ) values (
      p_group.church_id, p_group.id, p_account_id, v_member_id, 'account', 'member', 'active',
      p_source, p_actor_user_id
    )
    returning id into v_id;
  end if;

  -- A request that is no longer needed.
  update public.group_join_requests
     set status = case when p_source = 'approval' then status else 'cancelled' end,
         updated_at = now()
   where group_id = p_group.id
     and account_id = p_account_id
     and status = 'pending';

  -- A group member is one of the church's people (see above). Never fails the
  -- join: a person is still in the group while staff confirm who they are.
  begin
    perform public.connect_group_member_people(p_account_id, p_group.church_id, null);
  exception when others then
    raise warning 'connect_group_member_people(%, %) failed: %',
      p_account_id, p_group.church_id, sqlerrm;
  end;

  return v_id;
end;
$$;

-- outcome:
--   joined | already_member | requested | already_requested
--   full | closed | invitation_required | banned | not_found | not_eligible
create or replace function public.group_join(
  p_group_id uuid,
  p_account_id uuid,
  p_message text default null,
  p_invitation_token_hash text default null,
  p_now timestamptz default now()
)
returns table (outcome text, membership_id uuid, request_id uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  g public.groups%rowtype;
  v_membership public.group_memberships%rowtype;
  v_invitation public.group_invitations%rowtype;
  v_has_invitation boolean := false;
  v_request uuid;
  v_membership_id uuid;
  v_user uuid;
begin
  select * into g from public.groups where id = p_group_id for update;
  if not found or g.status <> 'active' then
    return query select 'not_found'::text, null::uuid, null::uuid;
    return;
  end if;

  -- Somebody with no usable relationship to this church learns nothing about
  -- its groups, including that this one exists.
  if not public.group_account_can_participate(p_account_id, g.church_id) then
    return query select 'not_found'::text, null::uuid, null::uuid;
    return;
  end if;

  select a.user_id into v_user from public.visitor_accounts a where a.id = p_account_id;

  v_membership := public.group_membership_for_account(g.id, p_account_id);
  if v_membership.id is not null and v_membership.status = 'active' then
    return query select 'already_member'::text, v_membership.id, null::uuid;
    return;
  end if;

  if public.group_is_banned(g.id, p_account_id, public.linked_member_id(p_account_id, g.church_id)) then
    return query select 'banned'::text, null::uuid, null::uuid;
    return;
  end if;

  if p_invitation_token_hash is not null then
    select * into v_invitation
      from public.group_invitations i
     where i.token_hash = p_invitation_token_hash
     for update;

    v_has_invitation := v_invitation.id is not null
      and v_invitation.group_id = g.id
      and v_invitation.revoked_at is null
      and v_invitation.expires_at > p_now
      and v_invitation.used_count < v_invitation.max_uses;

    if not v_has_invitation then
      return query select 'invitation_invalid'::text, null::uuid, null::uuid;
      return;
    end if;
  end if;

  -- A private group is reached only by invitation (or by a leader or staff
  -- adding someone). Without one it does not exist, whatever its enrollment
  -- says — including to a former member, who learns nothing new from that.
  if g.visibility = 'private' and not v_has_invitation then
    return query select 'not_found'::text, null::uuid, null::uuid;
    return;
  end if;

  if not v_has_invitation then
    if g.enrollment = 'closed' then
      return query select 'closed'::text, null::uuid, null::uuid;
      return;
    elsif g.enrollment = 'invitation_only' then
      return query select 'invitation_required'::text, null::uuid, null::uuid;
      return;
    end if;
  end if;

  if g.capacity is not null and g.member_count >= g.capacity then
    return query select 'full'::text, null::uuid, null::uuid;
    return;
  end if;

  if v_has_invitation or g.enrollment = 'open' then
    v_membership_id := public.group_admit_account(
      g, p_account_id,
      case when v_has_invitation then 'invitation' else 'self' end,
      v_user
    );

    if v_has_invitation then
      update public.group_invitations
         set used_count = used_count + 1
       where id = v_invitation.id;
    end if;

    perform public.log_group_event(
      g.church_id, g.id, 'joined', 'member', v_user, v_membership_id, p_account_id,
      public.linked_member_id(p_account_id, g.church_id),
      jsonb_build_object('via', case when v_has_invitation then 'invitation' else 'open' end)
    );
    return query select 'joined'::text, v_membership_id, null::uuid;
    return;
  end if;

  -- approval_required
  select r.id into v_request
    from public.group_join_requests r
   where r.group_id = g.id and r.account_id = p_account_id and r.status = 'pending';

  if v_request is not null then
    return query select 'already_requested'::text, null::uuid, v_request;
    return;
  end if;

  insert into public.group_join_requests (church_id, group_id, account_id, message)
  values (g.church_id, g.id, p_account_id, nullif(btrim(coalesce(p_message, '')), ''))
  returning id into v_request;

  perform public.log_group_event(
    g.church_id, g.id, 'join_requested', 'member', v_user, null, p_account_id, null,
    '{}'::jsonb
  );

  return query select 'requested'::text, null::uuid, v_request;
end;
$$;

-- Redeems a share link. The token names the group, so the client never does.
create or replace function public.group_accept_invitation(
  p_token_hash text,
  p_account_id uuid,
  p_now timestamptz default now()
)
returns table (outcome text, membership_id uuid, group_id uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_group uuid;
  v_result record;
begin
  select i.group_id into v_group
    from public.group_invitations i
   where i.token_hash = p_token_hash;

  if v_group is null then
    return query select 'invitation_invalid'::text, null::uuid, null::uuid;
    return;
  end if;

  select * into v_result
    from public.group_join(v_group, p_account_id, null, p_token_hash, p_now);

  return query select v_result.outcome, v_result.membership_id,
    case when v_result.outcome in ('joined', 'already_member') then v_group else null end;
end;
$$;

-- outcome: left | request_cancelled | not_member
create or replace function public.group_leave(
  p_group_id uuid,
  p_account_id uuid
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  g public.groups%rowtype;
  v_membership public.group_memberships%rowtype;
  v_user uuid;
begin
  select * into g from public.groups where id = p_group_id for update;
  if not found then
    return 'not_member';
  end if;

  select a.user_id into v_user from public.visitor_accounts a where a.id = p_account_id;
  v_membership := public.group_membership_for_account(g.id, p_account_id);

  if v_membership.id is not null and v_membership.status = 'active' then
    update public.group_memberships
       set status = 'left', ended_at = now(), ended_reason = 'left', ended_by = v_user,
           updated_at = now()
     where id = v_membership.id;
    perform public.log_group_event(
      g.church_id, g.id, 'left', 'member', v_user, v_membership.id, p_account_id,
      v_membership.member_id, '{}'::jsonb
    );
    return 'left';
  end if;

  update public.group_join_requests
     set status = 'cancelled', updated_at = now()
   where group_id = g.id and account_id = p_account_id and status = 'pending';
  if found then
    perform public.log_group_event(
      g.church_id, g.id, 'join_request_cancelled', 'member', v_user, null, p_account_id, null,
      '{}'::jsonb
    );
    return 'request_cancelled';
  end if;

  return 'not_member';
end;
$$;

-- outcome: approved | declined | already_decided | full | not_found | requester_unavailable | banned
create or replace function public.group_decide_request(
  p_request_id uuid,
  p_church_id uuid,
  p_group_id uuid,
  p_decision text,
  p_actor_user_id uuid,
  p_actor_type text,
  p_allow_over_capacity boolean default false
)
returns table (outcome text, membership_id uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_request public.group_join_requests%rowtype;
  g public.groups%rowtype;
  v_membership_id uuid;
begin
  if p_decision not in ('approve', 'decline') then
    raise exception 'invalid decision' using errcode = 'check_violation';
  end if;

  -- The request must belong to this church *and* this group: a leader of one
  -- group cannot decide another group's request by naming its id.
  select * into v_request
    from public.group_join_requests
   where id = p_request_id and church_id = p_church_id and group_id = p_group_id;
  if not found then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  -- The group lock first, then the request: the same order every command uses.
  select * into g from public.groups where id = v_request.group_id and church_id = p_church_id for update;
  select * into v_request from public.group_join_requests where id = p_request_id for update;

  if v_request.status <> 'pending' then
    return query select 'already_decided'::text, null::uuid;
    return;
  end if;

  if p_decision = 'decline' then
    update public.group_join_requests
       set status = 'declined', decided_by = p_actor_user_id, decided_at = now(), updated_at = now()
     where id = v_request.id;
    perform public.log_group_event(
      g.church_id, g.id, 'join_request_declined', p_actor_type, p_actor_user_id, null,
      v_request.account_id, null, '{}'::jsonb
    );
    return query select 'declined'::text, null::uuid;
    return;
  end if;

  if g.status <> 'active' then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  if not public.group_account_can_participate(v_request.account_id, g.church_id) then
    update public.group_join_requests
       set status = 'cancelled', updated_at = now()
     where id = v_request.id;
    return query select 'requester_unavailable'::text, null::uuid;
    return;
  end if;

  if public.group_is_banned(g.id, v_request.account_id, public.linked_member_id(v_request.account_id, g.church_id)) then
    return query select 'banned'::text, null::uuid;
    return;
  end if;

  if not p_allow_over_capacity and g.capacity is not null and g.member_count >= g.capacity then
    return query select 'full'::text, null::uuid;
    return;
  end if;

  update public.group_join_requests
     set status = 'approved', decided_by = p_actor_user_id, decided_at = now(), updated_at = now()
   where id = v_request.id;

  v_membership_id := public.group_admit_account(g, v_request.account_id, 'approval', p_actor_user_id);

  perform public.log_group_event(
    g.church_id, g.id, 'join_request_approved', p_actor_type, p_actor_user_id, v_membership_id,
    v_request.account_id, public.linked_member_id(v_request.account_id, g.church_id), '{}'::jsonb
  );

  return query select 'approved'::text, v_membership_id;
end;
$$;

-- Staff (from People) or a leader adds someone directly.
-- outcome: added | already_member | banned | not_found | not_eligible | full
create or replace function public.group_add_member(
  p_group_id uuid,
  p_church_id uuid,
  p_member_id uuid,
  p_account_id uuid,
  p_group_role text,
  p_actor_user_id uuid,
  p_actor_type text,
  p_allow_over_capacity boolean default false
)
returns table (outcome text, membership_id uuid)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  g public.groups%rowtype;
  v_member uuid := p_member_id;
  v_account uuid := p_account_id;
  v_existing public.group_memberships%rowtype;
  v_id uuid;
begin
  if p_group_role not in ('member', 'leader', 'manager') then
    raise exception 'invalid role' using errcode = 'check_violation';
  end if;
  if v_member is null and v_account is null then
    raise exception 'a person is required' using errcode = 'check_violation';
  end if;

  select * into g from public.groups where id = p_group_id and church_id = p_church_id for update;
  if not found or g.status <> 'active' then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;

  -- Every id must belong to this church.
  if v_member is not null and not exists (
    select 1 from public.members m where m.id = v_member and m.church_id = g.church_id
  ) then
    return query select 'not_found'::text, null::uuid;
    return;
  end if;
  if v_account is not null and not public.group_account_can_participate(v_account, g.church_id) then
    return query select 'not_eligible'::text, null::uuid;
    return;
  end if;

  -- Fill in whichever identity the People link knows.
  if v_account is null then
    v_account := public.linked_account_id(v_member);
    if v_account is not null and not public.group_account_can_participate(v_account, g.church_id) then
      v_account := null;
    end if;
  end if;
  if v_member is null then
    v_member := public.linked_member_id(v_account, g.church_id);
  end if;

  if public.group_is_banned(g.id, v_account, v_member) then
    return query select 'banned'::text, null::uuid;
    return;
  end if;

  select * into v_existing
    from public.group_memberships m
   where m.group_id = g.id
     and ((v_account is not null and m.account_id = v_account)
          or (v_member is not null and m.member_id = v_member))
   order by (m.account_id is not distinct from v_account) desc
   limit 1
   for update;

  if v_existing.id is not null and v_existing.status = 'active' then
    return query select 'already_member'::text, v_existing.id;
    return;
  end if;

  if not p_allow_over_capacity and g.capacity is not null and g.member_count >= g.capacity then
    return query select 'full'::text, null::uuid;
    return;
  end if;

  if v_existing.id is not null then
    update public.group_memberships
       set account_id = coalesce(v_account, account_id),
           member_id = coalesce(v_member, member_id),
           status = 'active', group_role = p_group_role,
           joined_at = now(), ended_at = null, ended_reason = null, ended_by = null,
           source = case when p_actor_type = 'staff' then 'staff' else 'leader' end,
           added_by = p_actor_user_id, notification_level = 'default',
           updated_at = now()
     where id = v_existing.id
    returning id into v_id;
  else
    insert into public.group_memberships (
      church_id, group_id, account_id, member_id, origin, group_role, status, source, added_by
    ) values (
      g.church_id, g.id, v_account, v_member,
      case when p_member_id is not null then 'people' else 'account' end,
      p_group_role, 'active',
      case when p_actor_type = 'staff' then 'staff' else 'leader' end,
      p_actor_user_id
    )
    returning id into v_id;
  end if;

  update public.group_join_requests
     set status = 'approved', decided_by = p_actor_user_id, decided_at = now(), updated_at = now()
   where group_id = g.id and account_id = v_account and status = 'pending';

  if v_account is not null and v_member is null then
    begin
      perform public.connect_group_member_people(v_account, g.church_id, null);
    exception when others then
      raise warning 'connect_group_member_people(%, %) failed: %', v_account, g.church_id, sqlerrm;
    end;
  end if;

  perform public.log_group_event(
    g.church_id, g.id, 'member_added', p_actor_type, p_actor_user_id, v_id, v_account, v_member,
    jsonb_build_object('role', p_group_role)
  );

  return query select 'added'::text, v_id;
end;
$$;

-- outcome: removed | banned | not_found
create or replace function public.group_remove_member(
  p_membership_id uuid,
  p_church_id uuid,
  p_group_id uuid,
  p_ban boolean,
  p_reason text,
  p_actor_user_id uuid,
  p_actor_type text
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_membership public.group_memberships%rowtype;
  g public.groups%rowtype;
begin
  select * into v_membership
    from public.group_memberships
   where id = p_membership_id and church_id = p_church_id and group_id = p_group_id;
  if not found then
    return 'not_found';
  end if;

  select * into g from public.groups where id = v_membership.group_id for update;
  select * into v_membership from public.group_memberships where id = p_membership_id for update;

  if v_membership.status = 'active' then
    update public.group_memberships
       set status = 'removed', ended_at = now(),
           ended_reason = case when p_ban then 'banned' else 'removed' end,
           ended_by = p_actor_user_id, updated_at = now()
     where id = v_membership.id;
  end if;

  if p_ban and not public.group_is_banned(g.id, v_membership.account_id, v_membership.member_id) then
    insert into public.group_bans (church_id, group_id, account_id, member_id, reason, banned_by)
    values (g.church_id, g.id, v_membership.account_id, v_membership.member_id,
            nullif(btrim(coalesce(p_reason, '')), ''), p_actor_user_id);
  end if;

  perform public.log_group_event(
    g.church_id, g.id, case when p_ban then 'member_banned' else 'member_removed' end,
    p_actor_type, p_actor_user_id, v_membership.id, v_membership.account_id,
    v_membership.member_id,
    jsonb_build_object('reason', nullif(btrim(coalesce(p_reason, '')), ''))
  );

  return case when p_ban then 'banned' else 'removed' end;
end;
$$;

-- outcome: updated | unchanged | not_found
create or replace function public.group_set_role(
  p_membership_id uuid,
  p_church_id uuid,
  p_group_id uuid,
  p_group_role text,
  p_actor_user_id uuid,
  p_actor_type text
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_membership public.group_memberships%rowtype;
  g public.groups%rowtype;
begin
  if p_group_role not in ('member', 'leader', 'manager') then
    raise exception 'invalid role' using errcode = 'check_violation';
  end if;

  select * into v_membership
    from public.group_memberships
   where id = p_membership_id and church_id = p_church_id and group_id = p_group_id;
  if not found or v_membership.status <> 'active' then
    return 'not_found';
  end if;

  select * into g from public.groups where id = v_membership.group_id for update;

  if v_membership.group_role = p_group_role then
    return 'unchanged';
  end if;

  update public.group_memberships
     set group_role = p_group_role, role_changed_at = now(), updated_at = now()
   where id = v_membership.id;

  perform public.log_group_event(
    g.church_id, g.id, 'role_changed', p_actor_type, p_actor_user_id, v_membership.id,
    v_membership.account_id, v_membership.member_id,
    jsonb_build_object('from', v_membership.group_role, 'to', p_group_role)
  );

  return 'updated';
end;
$$;

-- ---------------------------------------------------------------------------
-- GATHERINGS FROM SCHEDULES
-- ---------------------------------------------------------------------------
--
-- Deterministic and idempotent, like service-occurrence generation: the slot
-- is resolved from the local date and time in the schedule's own zone by
-- Postgres (DST-correct), and `on conflict do nothing` makes re-runs and
-- concurrent runs harmless.

create or replace function public.group_schedule_dates(
  p_frequency text,
  p_day_of_week integer,
  p_week_of_month integer,
  p_starts_on date,
  p_ends_on date,
  p_from date,
  p_to date
)
returns setof date
language plpgsql
immutable
set search_path = public
as $$
declare
  v_first date;
  v_day date;
  v_month date;
  v_candidate date;
begin
  if p_to < p_from then
    return;
  end if;

  -- The schedule's first real meeting on or after its start date.
  v_first := p_starts_on + ((p_day_of_week - extract(dow from p_starts_on)::integer + 7) % 7);

  if p_frequency in ('weekly', 'biweekly') then
    v_day := v_first;
    if v_day < p_from then
      -- Jump forward in whole periods rather than walking day by day.
      v_day := v_day + (((p_from - v_day) + (case when p_frequency = 'weekly' then 6 else 13 end))
                        / (case when p_frequency = 'weekly' then 7 else 14 end))
                       * (case when p_frequency = 'weekly' then 7 else 14 end);
    end if;
    while v_day <= p_to and (p_ends_on is null or v_day <= p_ends_on) loop
      return next v_day;
      v_day := v_day + case when p_frequency = 'weekly' then 7 else 14 end;
    end loop;
    return;
  end if;

  -- monthly: the nth weekday of each month, or the last.
  v_month := date_trunc('month', greatest(p_from, p_starts_on))::date;
  while v_month <= p_to loop
    if p_week_of_month = -1 then
      v_candidate := (v_month + interval '1 month - 1 day')::date;
      v_candidate := v_candidate - ((extract(dow from v_candidate)::integer - p_day_of_week + 7) % 7);
    else
      v_candidate := v_month + ((p_day_of_week - extract(dow from v_month)::integer + 7) % 7)
                     + (p_week_of_month - 1) * 7;
    end if;

    if v_candidate between greatest(p_from, p_starts_on) and p_to
       and (p_ends_on is null or v_candidate <= p_ends_on)
       and extract(month from v_candidate) = extract(month from v_month) then
      return next v_candidate;
    end if;
    v_month := (v_month + interval '1 month')::date;
  end loop;
end;
$$;

create or replace function public.generate_group_events(
  p_church_id uuid default null,
  p_group_id uuid default null,
  p_horizon_days integer default 56,
  p_now timestamptz default now()
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  s record;
  v_date date;
  v_start timestamptz;
  v_created integer := 0;
  v_inserted uuid;
begin
  if p_horizon_days < 1 or p_horizon_days > 120 then
    raise exception 'horizon out of range' using errcode = 'check_violation';
  end if;

  for s in
    select sc.*, gr.name as group_name
      from public.group_meeting_schedules sc
      join public.groups gr on gr.id = sc.group_id
     where sc.is_active
       and gr.status = 'active'
       and (p_church_id is null or sc.church_id = p_church_id)
       and (p_group_id is null or sc.group_id = p_group_id)
  loop
    for v_date in
      select d from public.group_schedule_dates(
        s.frequency, s.day_of_week, s.week_of_month, s.starts_on, s.ends_on,
        (p_now at time zone s.timezone)::date,
        ((p_now at time zone s.timezone)::date + p_horizon_days)
      ) d
    loop
      v_start := ((v_date + s.start_time)::timestamp) at time zone s.timezone;
      if v_start <= p_now then
        continue;
      end if;

      insert into public.group_events (
        church_id, group_id, schedule_id, title, starts_at, ends_at, timezone,
        status, is_generated, generated_for
      ) values (
        s.church_id, s.group_id, s.id, s.group_name, v_start,
        v_start + make_interval(mins => s.duration_minutes), s.timezone,
        'scheduled', true, v_start
      )
      on conflict (schedule_id, generated_for)
        where schedule_id is not null and generated_for is not null
      do nothing
      returning id into v_inserted;

      if v_inserted is not null then
        v_created := v_created + 1;
        v_inserted := null;
      end if;
    end loop;
  end loop;

  return v_created;
end;
$$;

-- A schedule changed: future generated gatherings nobody has touched, that
-- have no attendance and no RSVPs, give way to the new pattern.
create or replace function public.regenerate_group_schedule_events(
  p_schedule_id uuid,
  p_church_id uuid,
  p_now timestamptz default now()
)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_group uuid;
begin
  select group_id into v_group
    from public.group_meeting_schedules
   where id = p_schedule_id and church_id = p_church_id;
  if v_group is null then
    return 0;
  end if;

  delete from public.group_events e
   where e.schedule_id = p_schedule_id
     and e.is_generated
     and not e.is_modified
     and e.starts_at > p_now
     and not exists (select 1 from public.group_attendance_records a where a.event_id = e.id)
     and not exists (select 1 from public.group_event_rsvps r where r.event_id = e.id);

  return public.generate_group_events(p_church_id, v_group, 56, p_now);
end;
$$;

-- ---------------------------------------------------------------------------
-- ATTENDANCE FOR A GATHERING
-- ---------------------------------------------------------------------------

-- The occurrence behind a gathering, created on first use. Manual and admin
-- sources only; the window opens a day before and closes 30 days after, so a
-- leader can take attendance at the table or the next week.
create or replace function public.ensure_group_event_occurrence(
  p_event_id uuid,
  p_church_id uuid,
  p_actor_user_id uuid default null
)
returns uuid
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  e public.group_events%rowtype;
  g public.groups%rowtype;
  v_id uuid;
begin
  select * into e from public.group_events where id = p_event_id and church_id = p_church_id;
  if not found then
    return null;
  end if;

  select o.id into v_id from public.service_occurrences o where o.group_event_id = e.id;
  if v_id is not null then
    return v_id;
  end if;

  select * into g from public.groups where id = e.group_id;

  insert into public.service_occurrences (
    church_id, campus_id, service_time_id, label, local_service_date, timezone,
    starts_at_utc, ends_at_utc, checkin_opens_at_utc, checkin_closes_at_utc,
    status, generation_source, policy_version, policy_snapshot,
    group_id, group_event_id, created_by
  ) values (
    e.church_id, g.campus_id, null, left(coalesce(nullif(btrim(e.title), ''), g.name), 200),
    (e.starts_at at time zone e.timezone)::date, e.timezone,
    e.starts_at, e.ends_at,
    e.starts_at - interval '1 day', e.ends_at + interval '30 days',
    case when e.status = 'cancelled' then 'cancelled' else 'scheduled' end,
    'group', 1,
    jsonb_build_object(
      'sources', jsonb_build_object(
        'manual', true, 'admin', true, 'geofence', false, 'qr', false, 'kiosk', false
      ),
      'correctionRole', 'staff'
    ),
    g.id, e.id, p_actor_user_id
  )
  on conflict (group_event_id) where group_event_id is not null do nothing
  returning id into v_id;

  if v_id is null then
    select o.id into v_id from public.service_occurrences o where o.group_event_id = e.id;
  end if;

  update public.group_events set updated_at = now() where id = e.id;
  return v_id;
end;
$$;

-- Records a gathering's attendance in one transaction: everyone listed present
-- is counted through `record_attendance` — the one command — and anyone counted
-- earlier but no longer listed is reversed through `correct_attendance`, the
-- one correction. Resubmitting the same list changes nothing.
--
-- outcome per call: recorded | not_found | cancelled | too_early | too_late
create or replace function public.record_group_attendance(
  p_event_id uuid,
  p_church_id uuid,
  p_present_member_ids uuid[],
  p_guest_count integer,
  p_first_time_guest_count integer,
  p_notes text,
  p_actor_user_id uuid,
  p_actor_type text,
  p_batch_key text,
  p_roster_only boolean default true,
  p_now timestamptz default now()
)
returns table (
  outcome text,
  present_count integer,
  absent_count integer,
  guest_count integer,
  rejected_member_ids uuid[]
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  e public.group_events%rowtype;
  v_occurrence public.service_occurrences%rowtype;
  v_occurrence_id uuid;
  v_roster uuid[];
  v_unrecorded integer;
  v_present uuid[];
  v_target uuid;
  v_result record;
  v_fact record;
  v_rejected uuid[] := '{}';
  v_present_count integer;
  v_absent_count integer;
  v_attempt_actor text := case when p_actor_type = 'leader' then 'leader' else 'staff' end;
begin
  if p_actor_type not in ('leader', 'staff') then
    raise exception 'invalid actor' using errcode = 'check_violation';
  end if;
  if coalesce(array_length(p_present_member_ids, 1), 0) > 1000 then
    raise exception 'batch too large' using errcode = 'check_violation';
  end if;
  if coalesce(p_guest_count, 0) < 0 or coalesce(p_first_time_guest_count, 0) < 0
     or coalesce(p_first_time_guest_count, 0) > coalesce(p_guest_count, 0) then
    raise exception 'invalid guest counts' using errcode = 'check_violation';
  end if;

  select * into e from public.group_events
   where id = p_event_id and church_id = p_church_id
   for update;
  if not found then
    return query select 'not_found'::text, 0, 0, 0, '{}'::uuid[];
    return;
  end if;
  if e.status = 'cancelled' then
    return query select 'cancelled'::text, 0, 0, 0, '{}'::uuid[];
    return;
  end if;

  v_occurrence_id := public.ensure_group_event_occurrence(e.id, e.church_id, p_actor_user_id);
  select * into v_occurrence from public.service_occurrences where id = v_occurrence_id;

  if p_now < v_occurrence.checkin_opens_at_utc then
    return query select 'too_early'::text, 0, 0, 0, '{}'::uuid[];
    return;
  end if;
  if p_now > v_occurrence.checkin_closes_at_utc then
    return query select 'too_late'::text, 0, 0, 0, '{}'::uuid[];
    return;
  end if;

  -- The roster: active members with a People record, as of now.
  select coalesce(array_agg(distinct m.member_id), '{}'),
         count(*) filter (where m.member_id is null)
    into v_roster, v_unrecorded
    from public.group_memberships m
   where m.group_id = e.group_id
     and m.status = 'active';
  v_roster := array_remove(v_roster, null);

  select coalesce(array_agg(distinct x), '{}') into v_present
    from unnest(coalesce(p_present_member_ids, '{}')) x;

  -- A leader may only mark their own group. Staff may add a known guest.
  if p_roster_only then
    select coalesce(array_agg(x), '{}') into v_rejected
      from unnest(v_present) x
     where not (x = any (v_roster));
    select coalesce(array_agg(x), '{}') into v_present
      from unnest(v_present) x
     where x = any (v_roster);
  end if;

  foreach v_target in array v_present loop
    select * into v_result
      from public.record_attendance(
        p_occurrence_id := v_occurrence_id,
        p_member_id := v_target,
        p_source := 'manual',
        p_actor_type := v_attempt_actor,
        p_idempotency_key := p_batch_key || ':' || v_target::text,
        p_account_id := null,
        p_actor_user_id := p_actor_user_id,
        p_now := p_now
      );

    -- Decided by the fact as it now stands, not by the outcome string: a
    -- retried submission answers from its first attempt, and a person marked
    -- absent in between has a reversed fact that must come back.
    select f.id, f.status into v_fact
      from public.attendance_facts f
     where f.service_occurrence_id = v_occurrence_id
       and f.member_id = v_target;

    if v_fact.id is null then
      v_rejected := v_rejected || v_target;
    elsif v_fact.status = 'reversed' then
      perform public.correct_attendance(
        v_fact.id, e.church_id, 'restore', p_actor_user_id,
        'Marked present by the group', p_now
      );
    end if;
    v_fact := null;
  end loop;

  -- Anyone counted who is no longer listed was marked absent.
  for v_fact in
    select f.id
      from public.attendance_facts f
     where f.service_occurrence_id = v_occurrence_id
       and f.status = 'active'
       and not (f.member_id = any (v_present))
  loop
    perform public.correct_attendance(
      v_fact.id, e.church_id, 'reverse', p_actor_user_id,
      'Marked absent by the group', p_now
    );
  end loop;

  select count(*) into v_present_count
    from public.attendance_facts f
   where f.service_occurrence_id = v_occurrence_id and f.status = 'active';

  select count(*) into v_absent_count
    from unnest(v_roster) r
   where not exists (
     select 1 from public.attendance_facts f
      where f.service_occurrence_id = v_occurrence_id
        and f.status = 'active'
        and f.member_id = r
   );

  insert into public.group_attendance_records (
    event_id, church_id, group_id, occurrence_id, roster_member_ids, unrecorded_count,
    present_count, absent_count, guest_count, first_time_guest_count, notes,
    recorded_by, recorded_at, updated_at
  ) values (
    e.id, e.church_id, e.group_id, v_occurrence_id, v_roster, v_unrecorded,
    v_present_count, v_absent_count, coalesce(p_guest_count, 0),
    coalesce(p_first_time_guest_count, 0), nullif(btrim(coalesce(p_notes, '')), ''),
    p_actor_user_id, p_now, p_now
  )
  on conflict (event_id) do update
     set roster_member_ids = excluded.roster_member_ids,
         unrecorded_count = excluded.unrecorded_count,
         present_count = excluded.present_count,
         absent_count = excluded.absent_count,
         guest_count = excluded.guest_count,
         first_time_guest_count = excluded.first_time_guest_count,
         notes = excluded.notes,
         recorded_by = excluded.recorded_by,
         updated_at = excluded.updated_at;

  perform public.log_group_event(
    e.church_id, e.group_id, 'attendance_recorded', p_actor_type, p_actor_user_id,
    null, null, null,
    jsonb_build_object(
      'eventId', e.id, 'present', v_present_count, 'absent', v_absent_count,
      'guests', coalesce(p_guest_count, 0)
    )
  );

  return query select 'recorded'::text, v_present_count, v_absent_count,
    coalesce(p_guest_count, 0), v_rejected;
end;
$$;

-- ---------------------------------------------------------------------------
-- DISCOVERY
-- ---------------------------------------------------------------------------
--
-- What someone browsing a church's groups may see. Active, public groups only;
-- every column named, so a private column added to `groups` later cannot leak
-- through here. The exact meeting address is never returned (it is members-
-- only unless the church chose otherwise, and the detail endpoint decides).

create or replace function public.discover_groups(
  p_church_id uuid,
  p_query text default null,
  p_type_id uuid default null,
  p_day_of_week integer default null,
  p_campus_id uuid default null,
  p_open_only boolean default false,
  p_cursor_name text default null,
  p_cursor_id uuid default null,
  p_limit integer default 20
)
returns table (
  id uuid,
  name text,
  description text,
  cover_image_url text,
  type_id uuid,
  type_name text,
  type_icon text,
  enrollment text,
  capacity integer,
  member_count integer,
  campus_id uuid,
  campus_name text,
  location_name text,
  safety_profile text,
  version integer,
  cursor_name text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    g.id, g.name, g.description, g.cover_image_url,
    g.type_id, t.name, t.icon,
    g.enrollment, g.capacity, g.member_count,
    g.campus_id, cc.name,
    case when g.location_visibility = 'public' then g.location_name else null end,
    g.safety_profile, g.version,
    lower(g.name)
  from public.groups g
  left join public.group_types t on t.id = g.type_id
  left join public.church_campuses cc on cc.id = g.campus_id
  where g.church_id = p_church_id
    and g.status = 'active'
    and g.visibility = 'public'
    and (p_query is null or g.name ilike '%' || p_query || '%' or g.description ilike '%' || p_query || '%')
    and (p_type_id is null or g.type_id = p_type_id)
    and (p_campus_id is null or g.campus_id = p_campus_id)
    and (p_day_of_week is null or exists (
      select 1 from public.group_meeting_schedules s
       where s.group_id = g.id and s.is_active and s.day_of_week = p_day_of_week
    ))
    and (not p_open_only or (
      g.enrollment in ('open', 'approval_required')
      and (g.capacity is null or g.member_count < g.capacity)
    ))
    and (
      p_cursor_name is null or p_cursor_id is null
      or (lower(g.name), g.id) > (p_cursor_name, p_cursor_id)
    )
  order by lower(g.name), g.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- ---------------------------------------------------------------------------
-- ANALYTICS
-- ---------------------------------------------------------------------------
--
-- Every figure has a written definition and is computed in SQL from the
-- authorities above. Nothing here is a score.

-- Church-wide summary over a window.
create or replace function public.group_church_summary(
  p_church_id uuid,
  p_window_days integer default 30,
  p_now timestamptz default now()
)
returns table (
  active_groups integer,
  archived_groups integer,
  memberships integer,
  people_in_groups integer,
  leaders integer,
  pending_requests integer,
  joined_in_window integer,
  left_in_window integer,
  gatherings_in_window integer,
  average_attendance numeric,
  attendance_rate numeric,
  upcoming_gatherings_7d integer,
  groups_without_recent_gathering integer
)
language sql
stable
security definer
set search_path = public
as $$
  with win as (
    select p_now - make_interval(days => greatest(p_window_days, 1)) as since
  ),
  g as (
    select * from public.groups where church_id = p_church_id and status <> 'deleted'
  ),
  m as (
    select m.* from public.group_memberships m
      join g on g.id = m.group_id
  ),
  recorded as (
    select a.* from public.group_attendance_records a, win
     where a.church_id = p_church_id
       and a.recorded_at >= win.since
       and exists (select 1 from public.group_events e where e.id = a.event_id and e.starts_at <= p_now)
  )
  select
    (select count(*) from g where status = 'active')::integer,
    (select count(*) from g where status = 'archived')::integer,
    (select count(*) from m where m.status = 'active')::integer,
    (select count(distinct coalesce(m.member_id::text, 'a:' || m.account_id::text))
       from m where m.status = 'active')::integer,
    (select count(distinct coalesce(m.member_id::text, 'a:' || m.account_id::text))
       from m where m.status = 'active' and m.group_role in ('leader', 'manager'))::integer,
    (select count(*) from public.group_join_requests r
       join g on g.id = r.group_id where r.status = 'pending')::integer,
    (select count(*) from m, win where m.joined_at >= win.since)::integer,
    (select count(*) from m, win where m.ended_at >= win.since and m.status <> 'active')::integer,
    (select count(*) from recorded)::integer,
    (select round(avg(present_count + guest_count)::numeric, 1) from recorded),
    (select case when sum(present_count + absent_count) > 0
             then round(sum(present_count)::numeric / sum(present_count + absent_count), 3)
             else null end
       from recorded),
    (select count(*) from public.group_events e join g on g.id = e.group_id
      where g.status = 'active' and e.status = 'scheduled'
        and e.starts_at >= p_now and e.starts_at < p_now + interval '7 days')::integer,
    (select count(*) from g, win
      where g.status = 'active'
        and g.created_at < win.since
        and not exists (
          select 1 from public.group_attendance_records a
           where a.group_id = g.id and a.recorded_at >= win.since
        ))::integer
$$;

-- Week by week: joins, departures, gatherings, attendance. `p_group_id` null is
-- the whole church.
create or replace function public.group_weekly_trend(
  p_church_id uuid,
  p_group_id uuid default null,
  p_weeks integer default 12,
  p_now timestamptz default now()
)
returns table (
  week_start date,
  joined integer,
  departed integer,
  gatherings integer,
  present integer,
  guests integer,
  expected integer
)
language sql
stable
security definer
set search_path = public
as $$
  with weeks as (
    select generate_series(
      date_trunc('week', p_now)::date - (least(greatest(p_weeks, 1), 52) - 1) * 7,
      date_trunc('week', p_now)::date,
      interval '7 days'
    )::date as week_start
  )
  select
    w.week_start,
    (select count(*) from public.group_memberships m
       join public.groups g on g.id = m.group_id
      where m.church_id = p_church_id and g.status <> 'deleted'
        and (p_group_id is null or m.group_id = p_group_id)
        and m.joined_at >= w.week_start and m.joined_at < w.week_start + 7)::integer,
    (select count(*) from public.group_memberships m
       join public.groups g on g.id = m.group_id
      where m.church_id = p_church_id and g.status <> 'deleted'
        and (p_group_id is null or m.group_id = p_group_id)
        and m.status <> 'active'
        and m.ended_at >= w.week_start and m.ended_at < w.week_start + 7)::integer,
    (select count(*) from public.group_attendance_records a
       join public.group_events e on e.id = a.event_id
      where a.church_id = p_church_id
        and (p_group_id is null or a.group_id = p_group_id)
        and e.starts_at >= w.week_start and e.starts_at < w.week_start + 7)::integer,
    (select coalesce(sum(a.present_count), 0) from public.group_attendance_records a
       join public.group_events e on e.id = a.event_id
      where a.church_id = p_church_id
        and (p_group_id is null or a.group_id = p_group_id)
        and e.starts_at >= w.week_start and e.starts_at < w.week_start + 7)::integer,
    (select coalesce(sum(a.guest_count), 0) from public.group_attendance_records a
       join public.group_events e on e.id = a.event_id
      where a.church_id = p_church_id
        and (p_group_id is null or a.group_id = p_group_id)
        and e.starts_at >= w.week_start and e.starts_at < w.week_start + 7)::integer,
    (select coalesce(sum(a.present_count + a.absent_count), 0) from public.group_attendance_records a
       join public.group_events e on e.id = a.event_id
      where a.church_id = p_church_id
        and (p_group_id is null or a.group_id = p_group_id)
        and e.starts_at >= w.week_start and e.starts_at < w.week_start + 7)::integer
  from weeks w
  order by w.week_start
$$;

-- Per member of one group: how many of the group's recorded gatherings since
-- they joined they attended, out of the last `p_lookback`.
--
-- Definitions shown to staff:
--   active   — attended at least one of the group's last N recorded gatherings
--              they were on the roster for;
--   inactive — on the roster for at least one of those and attended none;
--   new      — joined within the last 30 days (reported alongside, not instead).
create or replace function public.group_member_participation(
  p_group_id uuid,
  p_church_id uuid,
  p_lookback integer default 6,
  p_now timestamptz default now()
)
returns table (
  membership_id uuid,
  member_id uuid,
  account_id uuid,
  group_role text,
  joined_at timestamptz,
  expected integer,
  attended integer,
  last_attended_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with recent as (
    select a.event_id, a.occurrence_id, a.roster_member_ids, e.starts_at
      from public.group_attendance_records a
      join public.group_events e on e.id = a.event_id
     where a.group_id = p_group_id
       and a.church_id = p_church_id
       and e.starts_at <= p_now
     order by e.starts_at desc
     limit least(greatest(p_lookback, 1), 26)
  )
  select
    m.id, m.member_id, m.account_id, m.group_role, m.joined_at,
    (select count(*) from recent r where m.member_id = any (r.roster_member_ids))::integer,
    (select count(*) from recent r
       join public.attendance_facts f
         on f.service_occurrence_id = r.occurrence_id
        and f.member_id = m.member_id
        and f.status = 'active')::integer,
    (select max(o.starts_at_utc)
       from public.attendance_facts f
       join public.service_occurrences o on o.id = f.service_occurrence_id
      where o.group_id = p_group_id
        and f.member_id = m.member_id
        and f.status = 'active')
  from public.group_memberships m
  where m.group_id = p_group_id
    and m.church_id = p_church_id
    and m.status = 'active'
$$;

-- ---------------------------------------------------------------------------
-- CHURCH-WIDE ATTENDANCE KEEPS MEANING SERVICES
-- ---------------------------------------------------------------------------
--
-- A group gathering is an occurrence (`group_id` set) so its attendance goes
-- through the one authority, but it is not a church service. Three
-- church-wide functions would otherwise read it as one:
--
--   attendance_report                     Services' report would list it
--   attendance_presence                   "who came to church" would count it
--   refresh_upcoming_service_occurrences  would re-apply the church's check-in
--                                         policy — geofence, QR, kiosk — to it
--
-- Each is restated from its latest definition (0057, 0083, 0074) with exactly
-- one added predicate, `group_id is null`; signatures, grants and everything
-- else are unchanged. Church-wide pickers in application code carry the same
-- predicate (lib/attendance/v2/occurrences.ts and friends).

create or replace function public.attendance_report(
  p_church_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_campus_id uuid default null,
  p_source text default null
)
returns table (
  occurrence_id uuid,
  label text,
  local_service_date date,
  starts_at_utc timestamptz,
  campus_name text,
  counted integer,
  reversed integer,
  by_source jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  select
    o.id,
    o.label,
    o.local_service_date,
    o.starts_at_utc,
    cc.name,
    coalesce(counts.active_count, 0)::integer,
    coalesce(counts.reversed_count, 0)::integer,
    coalesce(counts.by_source, '{}'::jsonb)
  from public.service_occurrences o
  left join public.church_campuses cc on cc.id = o.campus_id
  left join lateral (
    select
      -- `sum(n)`, not `count(*)`: `af` is one row per (source, status), so
      -- counting rows counts *sources* rather than people. This is the fix.
      coalesce(sum(af.n) filter (where af.status = 'active'), 0)::integer as active_count,
      coalesce(sum(af.n) filter (where af.status = 'reversed'), 0)::integer as reversed_count,
      -- Unchanged, and was always correct: it summed `n` rather than rows.
      coalesce(
        jsonb_object_agg(af.source, af.n) filter (where af.status = 'active'),
        '{}'::jsonb
      ) as by_source
    from (
      select f.source, f.status, count(*)::integer as n
      from public.attendance_facts f
      where f.service_occurrence_id = o.id
        and (p_source is null or f.source = p_source)
      group by f.source, f.status
    ) af
  ) counts on true
  where o.church_id = p_church_id
    and o.starts_at_utc >= p_from
    and o.starts_at_utc < p_to
    and (p_campus_id is null or o.campus_id = p_campus_id)
    -- Services only: a group's gatherings report through Groups (0091).
    and o.group_id is null
  order by o.starts_at_utc desc, o.id desc
$$;

create or replace function public.attendance_presence(
  p_church_id uuid,
  p_from date,
  p_to date
)
returns table (member_id uuid, service_date date, method text)
language sql
stable
set search_path = public
as $$
  select e.member_id, r.service_date, 'weekly'::text
    from public.attendance_records r
    join public.attendance_entries e on e.record_id = r.id
   where r.church_id = p_church_id
     and r.service_date between p_from and p_to
     and e.status = 'present'
  union all
  select f.member_id,
         o.local_service_date,
         case f.source
           when 'geofence' then 'automatic'
           when 'qr' then 'scanned'
           when 'kiosk' then 'kiosk'
           else 'marked'
         end
    from public.service_occurrences o
    join public.attendance_facts f on f.service_occurrence_id = o.id
   where o.church_id = p_church_id
     and f.church_id = p_church_id
     and o.local_service_date between p_from and p_to
     and f.status = 'active'
     and f.source <> 'legacy'
     -- At church: a group's gathering is not a church service (0091).
     and o.group_id is null
  union all
  select s.member_id, s.local_service_date, 'room'::text
    from public.checkin_sessions s
   where s.church_id = p_church_id
     and s.local_service_date between p_from and p_to
     and s.status in ('checked_in', 'checked_out')
$$;

create or replace function public.refresh_upcoming_service_occurrences(
  p_church_id uuid,
  p_now timestamptz default now()
)
returns table (refreshed integer, retired integer)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  occ public.service_occurrences%rowtype;
  st record;
  schedule_found boolean;
  policy public.attendance_policies;
  zone text;
  place uuid;
  place_latitude numeric(9, 6);
  place_longitude numeric(9, 6);
  place_radius integer;
  next_label text;
  next_start timestamptz;
  next_end timestamptz;
  next_opens timestamptz;
  next_closes timestamptz;
  next_snapshot jsonb;
  referenced boolean;
  touched integer;
  refreshed_count integer := 0;
  retired_count integer := 0;
begin
  for occ in
    select o.*
      from public.service_occurrences o
     where o.church_id = p_church_id
       and o.status = 'scheduled'
       and o.checkin_opens_at_utc > p_now
       -- A group gathering's window and sources are its own (manual and
       -- admin only). The church's policy must never be re-applied to it.
       and o.group_id is null
     order by o.starts_at_utc, o.id
     for update
  loop
    if occ.generation_source = 'schedule' then
      select s.id, s.label, s.day_of_week, s.start_time, s.end_time, s.campus_id,
             c.timezone as campus_timezone,
             ch.timezone as church_timezone
        into st
        from public.church_service_times s
        join public.churches ch on ch.id = s.church_id
        left join public.church_campuses c
          on c.id = s.campus_id and c.is_active
       where s.id = occ.service_time_id
         and s.church_id = p_church_id;
      schedule_found := found;

      if schedule_found then
        zone := coalesce(st.campus_timezone, st.church_timezone, 'America/New_York');
        next_start := ((occ.local_service_date + st.start_time)::timestamp) at time zone zone;
      end if;

      if not schedule_found
         or extract(dow from occ.local_service_date)::integer <> st.day_of_week
         or next_start <> occ.starts_at_utc
      then
        referenced :=
          exists (select 1 from public.attendance_attempts a where a.service_occurrence_id = occ.id)
          or exists (select 1 from public.attendance_facts f where f.service_occurrence_id = occ.id)
          or exists (select 1 from public.attendance_corrections r where r.service_occurrence_id = occ.id)
          or exists (select 1 from public.attendance_detections d where d.service_occurrence_id = occ.id)
          or exists (select 1 from public.attendance_checkin_sessions s where s.service_occurrence_id = occ.id)
          or exists (select 1 from public.attendance_kiosk_sessions k where k.service_occurrence_id = occ.id);

        if referenced then
          -- Detached from the schedule as well as cancelled: it no longer
          -- belongs to that service time, and keeping the link would stop the
          -- generator creating the service again if the time is changed back.
          update public.service_occurrences
             set status = 'cancelled',
                 service_time_id = null,
                 cancelled_at = p_now,
                 cancellation_reason = 'schedule_changed',
                 updated_at = p_now
           where id = occ.id;
        else
          delete from public.service_occurrences where id = occ.id;
        end if;

        retired_count := retired_count + 1;
        continue;
      end if;

      next_label := st.label;
      next_end := ((occ.local_service_date + coalesce(st.end_time, st.start_time + interval '90 minutes'))::timestamp)
                  at time zone zone;
      if next_end <= next_start then
        next_end := next_end + interval '1 day';
      end if;

      policy := public.attendance_policy_for(p_church_id, st.campus_id, st.id);
      place := public.attendance_effective_campus(p_church_id, st.campus_id);
      next_opens := next_start - make_interval(mins => coalesce(policy.checkin_opens_minutes_before, 30));
      next_closes := next_end + make_interval(mins => coalesce(policy.checkin_closes_minutes_after, 30));
    else
      -- A manual service keeps the times and window its creator chose. Only
      -- the policy and the position it will be judged against are refreshed.
      next_label := occ.label;
      next_start := occ.starts_at_utc;
      next_end := occ.ends_at_utc;
      next_opens := occ.checkin_opens_at_utc;
      next_closes := occ.checkin_closes_at_utc;
      policy := public.attendance_policy_for(p_church_id, occ.campus_id, null);
      place := occ.campus_id;
    end if;

    place_latitude := null;
    place_longitude := null;
    place_radius := null;
    select c.latitude, c.longitude, c.geofence_radius_m
      into place_latitude, place_longitude, place_radius
      from public.church_campuses c
     where c.id = public.attendance_effective_campus(p_church_id, place)
       and c.church_id = p_church_id
       and c.is_active;

    next_snapshot := public.attendance_policy_snapshot(policy);

    update public.service_occurrences o
       set label = next_label,
           campus_id = place,
           ends_at_utc = next_end,
           checkin_opens_at_utc = next_opens,
           checkin_closes_at_utc = next_closes,
           policy_version = coalesce(policy.policy_version, 1),
           policy_snapshot = next_snapshot,
           campus_latitude = place_latitude,
           campus_longitude = place_longitude,
           geofence_radius_m = place_radius,
           updated_at = p_now
     where o.id = occ.id
       and (
         o.label is distinct from next_label
         or o.campus_id is distinct from place
         or o.ends_at_utc is distinct from next_end
         or o.checkin_opens_at_utc is distinct from next_opens
         or o.checkin_closes_at_utc is distinct from next_closes
         or o.policy_version is distinct from coalesce(policy.policy_version, 1)
         or o.policy_snapshot is distinct from next_snapshot
         or o.campus_latitude is distinct from place_latitude
         or o.campus_longitude is distinct from place_longitude
         or o.geofence_radius_m is distinct from place_radius
       );
    get diagnostics touched = row_count;
    refreshed_count := refreshed_count + touched;
  end loop;

  return query select refreshed_count, retired_count;
end;
$$;

-- Defence in depth for the automatic and self-service paths: a QR display, a
-- kiosk or a geofence detection can never be opened against a group
-- gathering, whatever id a caller supplies. Their occurrences' own snapshots
-- already refuse those sources; this refuses the artifact itself.
create or replace function public.refuse_group_occurrence_checkin_artifact()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if exists (
    select 1 from public.service_occurrences o
     where o.id = new.service_occurrence_id
       and o.group_id is not null
  ) then
    raise exception 'group gatherings take attendance from their leaders'
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

revoke all on function public.refuse_group_occurrence_checkin_artifact() from public, anon, authenticated;

drop trigger if exists attendance_checkin_sessions_not_group on public.attendance_checkin_sessions;
create trigger attendance_checkin_sessions_not_group
  before insert on public.attendance_checkin_sessions
  for each row execute function public.refuse_group_occurrence_checkin_artifact();

drop trigger if exists attendance_kiosk_sessions_not_group on public.attendance_kiosk_sessions;
create trigger attendance_kiosk_sessions_not_group
  before insert on public.attendance_kiosk_sessions
  for each row execute function public.refuse_group_occurrence_checkin_artifact();

drop trigger if exists attendance_detections_not_group on public.attendance_detections;
create trigger attendance_detections_not_group
  before insert on public.attendance_detections
  for each row execute function public.refuse_group_occurrence_checkin_artifact();

-- ---------------------------------------------------------------------------
-- LIFECYCLE
-- ---------------------------------------------------------------------------
--
-- archive  Out of Discover, no joins, future gatherings cancelled; the chat is
--          frozen by the reconciler, which reads `status`. History stays.
-- restore  The reverse — including the gatherings the archive itself
--          cancelled, when they are still ahead.
-- delete   Only an archived group. Memberships end, pending requests are
--          cancelled, invitations revoked, schedules stopped, and future
--          gatherings nobody has taken attendance for are removed. The row stays
--          as a tombstone so attendance history keeps its group; the reconciler
--          removes the binding, which deletes the conversation.
create or replace function public.group_set_lifecycle(
  p_group_id uuid,
  p_church_id uuid,
  p_action text,
  p_actor_user_id uuid,
  p_now timestamptz default now()
)
returns text
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  g public.groups%rowtype;
  v_count integer := 0;
begin
  if p_action is null or p_action not in ('archive', 'restore', 'delete') then
    raise exception 'invalid lifecycle action' using errcode = 'check_violation';
  end if;

  select * into g
    from public.groups
   where id = p_group_id
     and church_id = p_church_id
   for update;
  if g.id is null or g.status = 'deleted' then
    return 'not_found';
  end if;

  if p_action = 'archive' then
    if g.status = 'archived' then
      return 'unchanged';
    end if;
    update public.groups
       set status = 'archived', archived_at = p_now, archived_by = p_actor_user_id,
           updated_by = p_actor_user_id
     where id = g.id;
    update public.group_events
       set status = 'cancelled', cancelled_at = p_now, cancelled_by = p_actor_user_id,
           cancellation_reason = 'Group archived', updated_by = p_actor_user_id
     where group_id = g.id
       and status = 'scheduled'
       and starts_at > p_now;
    get diagnostics v_count = row_count;
    perform public.log_group_event(
      p_church_id, g.id, 'group_archived', 'staff', p_actor_user_id, null, null, null,
      jsonb_build_object('cancelledGatherings', v_count)
    );
    return 'archived';
  end if;

  if p_action = 'restore' then
    if g.status = 'active' then
      return 'unchanged';
    end if;
    update public.group_events
       set status = 'scheduled', cancelled_at = null, cancelled_by = null,
           cancellation_reason = null, updated_by = p_actor_user_id
     where group_id = g.id
       and status = 'cancelled'
       and cancellation_reason = 'Group archived'
       and cancelled_at = g.archived_at
       and starts_at > p_now;
    get diagnostics v_count = row_count;
    update public.groups
       set status = 'active', archived_at = null, archived_by = null,
           updated_by = p_actor_user_id
     where id = g.id;
    perform public.log_group_event(
      p_church_id, g.id, 'group_restored', 'staff', p_actor_user_id, null, null, null,
      jsonb_build_object('restoredGatherings', v_count)
    );
    return 'restored';
  end if;

  -- delete
  if g.status <> 'archived' then
    return 'not_archived';
  end if;

  update public.group_memberships
     set status = 'removed', ended_at = p_now, ended_reason = 'group_deleted',
         ended_by = p_actor_user_id, updated_at = p_now
   where group_id = g.id
     and status = 'active';
  get diagnostics v_count = row_count;

  update public.group_join_requests
     set status = 'cancelled', decided_at = p_now, updated_at = p_now
   where group_id = g.id
     and status = 'pending';

  update public.group_invitations
     set revoked_at = p_now, revoked_by = p_actor_user_id
   where group_id = g.id
     and revoked_at is null;

  update public.group_meeting_schedules
     set is_active = false, updated_at = p_now
   where group_id = g.id
     and is_active;

  delete from public.group_events e
   where e.group_id = g.id
     and e.starts_at > p_now
     and not exists (select 1 from public.service_occurrences o where o.group_event_id = e.id);

  update public.groups
     set status = 'deleted', deleted_at = p_now, updated_by = p_actor_user_id
   where id = g.id;

  perform public.log_group_event(
    p_church_id, g.id, 'group_deleted', 'staff', p_actor_user_id, null, null, null,
    jsonb_build_object('endedMemberships', v_count)
  );
  return 'deleted';
end;
$$;

-- ---------------------------------------------------------------------------
-- SEEDED CATEGORIES
-- ---------------------------------------------------------------------------

create or replace function public.ensure_default_group_types(p_church_id uuid)
returns integer
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_created integer;
begin
  if exists (select 1 from public.group_types where church_id = p_church_id) then
    return 0;
  end if;

  insert into public.group_types (church_id, name, icon, sort_order)
  values
    (p_church_id, 'Small Groups', 'users', 10),
    (p_church_id, 'Bible Studies', 'book', 20),
    (p_church_id, 'Youth', 'sparkles', 30),
    (p_church_id, 'Young Adults', 'compass', 40),
    (p_church_id, 'Men', 'user', 50),
    (p_church_id, 'Women', 'heart', 60),
    (p_church_id, 'Classes', 'graduation', 70),
    (p_church_id, 'Prayer Groups', 'prayer', 80),
    (p_church_id, 'Volunteer Teams', 'hands', 90),
    (p_church_id, 'Worship Teams', 'music', 100),
    (p_church_id, 'Ministries', 'church', 110),
    (p_church_id, 'Staff', 'briefcase', 120)
  on conflict do nothing;

  get diagnostics v_created = row_count;
  return v_created;
end;
$$;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
--
-- Start from nothing, then grant back only what the dashboard reads: staff of
-- the church who hold the Groups feature. No table has a browser write path.
-- Invitations are not readable by anyone but the service role.

alter table public.group_types enable row level security;
alter table public.groups enable row level security;
alter table public.group_meeting_schedules enable row level security;
alter table public.group_memberships enable row level security;
alter table public.group_join_requests enable row level security;
alter table public.group_invitations enable row level security;
alter table public.group_bans enable row level security;
alter table public.group_events enable row level security;
alter table public.group_event_rsvps enable row level security;
alter table public.group_attendance_records enable row level security;
alter table public.group_audit_events enable row level security;

revoke all on table public.group_types from public, anon, authenticated;
revoke all on table public.groups from public, anon, authenticated;
revoke all on table public.group_meeting_schedules from public, anon, authenticated;
revoke all on table public.group_memberships from public, anon, authenticated;
revoke all on table public.group_join_requests from public, anon, authenticated;
revoke all on table public.group_invitations from public, anon, authenticated;
revoke all on table public.group_bans from public, anon, authenticated;
revoke all on table public.group_events from public, anon, authenticated;
revoke all on table public.group_event_rsvps from public, anon, authenticated;
revoke all on table public.group_attendance_records from public, anon, authenticated;
revoke all on table public.group_audit_events from public, anon, authenticated;

grant select on table
  public.group_types,
  public.groups,
  public.group_meeting_schedules,
  public.group_memberships,
  public.group_join_requests,
  public.group_bans,
  public.group_events,
  public.group_event_rsvps,
  public.group_attendance_records,
  public.group_audit_events
  to authenticated;

grant select, insert, update, delete on table
  public.group_types,
  public.groups,
  public.group_meeting_schedules,
  public.group_memberships,
  public.group_join_requests,
  public.group_invitations,
  public.group_bans,
  public.group_events,
  public.group_event_rsvps,
  public.group_attendance_records,
  public.group_audit_events
  to service_role;

create policy group_types_select on public.group_types
  for select to authenticated using (public.has_groups_access(church_id));
create policy groups_select on public.groups
  for select to authenticated using (public.has_groups_access(church_id));
create policy group_meeting_schedules_select on public.group_meeting_schedules
  for select to authenticated using (public.has_groups_access(church_id));
create policy group_memberships_select on public.group_memberships
  for select to authenticated using (public.has_groups_access(church_id));
create policy group_join_requests_select on public.group_join_requests
  for select to authenticated using (public.has_groups_access(church_id));
create policy group_bans_select on public.group_bans
  for select to authenticated using (public.has_groups_access(church_id));
create policy group_events_select on public.group_events
  for select to authenticated using (public.has_groups_access(church_id));
create policy group_event_rsvps_select on public.group_event_rsvps
  for select to authenticated using (public.has_groups_access(church_id));
create policy group_attendance_records_select on public.group_attendance_records
  for select to authenticated using (public.has_groups_access(church_id));
create policy group_audit_events_select on public.group_audit_events
  for select to authenticated using (public.has_groups_access(church_id));

-- Every command and helper is server-only.
do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.log_group_event(uuid, uuid, text, text, uuid, uuid, uuid, uuid, jsonb)',
    'public.refresh_group_counts(uuid)',
    'public.linked_member_id(uuid, uuid)',
    'public.linked_account_id(uuid)',
    'public.group_membership_for_account(uuid, uuid)',
    'public.connect_group_member_people(uuid, uuid, uuid)',
    'public.reconcile_group_membership_link(uuid, uuid, uuid)',
    'public.detach_group_membership_link(uuid, uuid, uuid)',
    'public.group_account_can_participate(uuid, uuid)',
    'public.group_is_banned(uuid, uuid, uuid)',
    'public.group_admit_account(public.groups, uuid, text, uuid)',
    'public.group_join(uuid, uuid, text, text, timestamptz)',
    'public.group_accept_invitation(text, uuid, timestamptz)',
    'public.group_leave(uuid, uuid)',
    'public.group_decide_request(uuid, uuid, uuid, text, uuid, text, boolean)',
    'public.group_add_member(uuid, uuid, uuid, uuid, text, uuid, text, boolean)',
    'public.group_remove_member(uuid, uuid, uuid, boolean, text, uuid, text)',
    'public.group_set_role(uuid, uuid, uuid, text, uuid, text)',
    'public.generate_group_events(uuid, uuid, integer, timestamptz)',
    'public.regenerate_group_schedule_events(uuid, uuid, timestamptz)',
    'public.ensure_group_event_occurrence(uuid, uuid, uuid)',
    'public.record_group_attendance(uuid, uuid, uuid[], integer, integer, text, uuid, text, text, boolean, timestamptz)',
    'public.discover_groups(uuid, text, uuid, integer, uuid, boolean, text, uuid, integer)',
    'public.group_church_summary(uuid, integer, timestamptz)',
    'public.group_weekly_trend(uuid, uuid, integer, timestamptz)',
    'public.group_member_participation(uuid, uuid, integer, timestamptz)',
    'public.group_set_lifecycle(uuid, uuid, text, uuid, timestamptz)',
    'public.ensure_default_group_types(uuid)'
  ]
  loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end $$;

-- Trigger functions are not callable as RPCs, but the grant is revoked anyway so
-- the surface stays exactly what the list above says.
revoke all on function public.group_counts_after_change() from public, anon, authenticated;
revoke all on function public.group_memberships_follow_people_link() from public, anon, authenticated;
revoke all on function public.group_memberships_detach_account() from public, anon, authenticated;
revoke all on function public.group_memberships_detach_member() from public, anon, authenticated;
revoke all on function public.group_memberships_follow_church_relationship() from public, anon, authenticated;

notify pgrst, 'reload schema';
