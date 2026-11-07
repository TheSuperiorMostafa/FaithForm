-- Recurring events and group announcement notifications
-- Migration 0147
--
-- Adds support for:
-- 1. Recurring event occurrences (properly bounded and timezone-aware)
-- 2. Group announcement broadcasts through notification_outbox
-- 3. Volunteer schedule acceptance tracking

-- ---------------------------------------------------------------------------
-- RECURRING EVENT OCCURRENCES
-- ---------------------------------------------------------------------------

-- Tracks individual occurrences of recurring events for editing/cancellation
create table if not exists public.announcement_occurrences (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  announcement_id uuid not null references public.announcements (id) on delete cascade,
  
  -- Instance-specific overrides (null = use parent announcement values)
  occurrence_date date not null, -- The date this occurrence happens (church timezone)
  start_at timestamptz not null,
  end_at timestamptz,
  all_day boolean not null default false,
  
  -- Allow individual occurrence edits
  title text, -- null = use parent title
  description text, -- null = use parent description
  event_location text, -- null = use parent location
  
  -- Status of this specific occurrence
  status text not null default 'active' 
    check (status in ('active', 'cancelled', 'rescheduled')),
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users (id) on delete set null,
  cancellation_reason text,
  
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists announcement_occurrences_unique_date_idx
  on public.announcement_occurrences (announcement_id, occurrence_date)
  where status = 'active';

create index if not exists announcement_occurrences_church_date_idx
  on public.announcement_occurrences (church_id, occurrence_date desc)
  where status = 'active';

create index if not exists announcement_occurrences_parent_idx
  on public.announcement_occurrences (announcement_id, occurrence_date);

-- Track recurring event metadata on the parent announcement
alter table public.announcements
  add column if not exists recurrence_rule text,
  add column if not exists recurrence_until date,
  add column if not exists is_recurring boolean not null default false;

alter table public.announcements
  add constraint announcements_recurrence_check
  check (
    (not is_recurring) or (recurrence_rule is not null and recurrence_until is not null)
  );

comment on column public.announcements.recurrence_rule is 'RRULE string for recurring events (FREQ=DAILY/WEEKLY/MONTHLY;UNTIL=...)';
comment on column public.announcements.recurrence_until is 'Last date of recurrence (inclusive, in church timezone)';

-- RLS for announcement_occurrences (same pattern as announcements)
alter table public.announcement_occurrences enable row level security;

create policy "announcement_occurrences_select"
  on public.announcement_occurrences
  for select
  using (public.user_has_feature(church_id, 'announcements'));

revoke all on table public.announcement_occurrences from public, anon;
grant select on table public.announcement_occurrences to authenticated;
grant all on table public.announcement_occurrences to service_role;

-- ---------------------------------------------------------------------------
-- GROUP ANNOUNCEMENT NOTIFICATIONS
-- ---------------------------------------------------------------------------

-- Extend notification_outbox to support group announcements
alter table public.notification_outbox
  drop constraint if exists notification_outbox_kind_check;

alter table public.notification_outbox
  add constraint notification_outbox_kind_check
  check (kind in (
    'announcement_published', 'event_published', 'service_live', 'recording_published',
    'group_join_requested', 'group_request_approved', 'group_event_cancelled', 'group_message',
    'household_code_ready', 'checkin_guardian_alert',
    'group_announcement' -- NEW
  ));

alter table public.notification_outbox
  drop constraint if exists notification_outbox_subject_type_check;

alter table public.notification_outbox
  add constraint notification_outbox_subject_type_check
  check (subject_type in (
    'announcement', 'stream_event', 'stream_recording', 
    'group_join_request', 'group_event', 'group_message', 
    'household', 'checkin_session',
    'group' -- NEW for group_announcement
  ));

-- Update target shape check to allow group announcements with account_ids
alter table public.notification_outbox
  drop constraint if exists notification_outbox_target_shape_check;

alter table public.notification_outbox
  add constraint notification_outbox_target_shape_check
  check (
    (topic in ('groups', 'checkin')) = (target_account_ids is not null)
    and (target_account_ids is null or cardinality(target_account_ids) between 1 and 200)
    and (topic <> 'checkin' or (
      (kind = 'household_code_ready' and subject_type = 'household') or
      (kind = 'checkin_guardian_alert' and subject_type = 'checkin_session')
    ))
    and (kind not in ('household_code_ready', 'checkin_guardian_alert', 'group_announcement') or topic in ('checkin', 'groups'))
    and (subject_type not in ('household', 'checkin_session') or topic = 'checkin')
    and (kind <> 'group_announcement' or (subject_type = 'group' and topic = 'groups'))
  );

-- ---------------------------------------------------------------------------
-- VOLUNTEER SCHEDULE ACCEPTANCE
-- ---------------------------------------------------------------------------

-- Track volunteer responses to group event assignments/invites
create table if not exists public.group_event_responses (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  group_id uuid not null references public.groups (id) on delete cascade,
  event_id uuid not null references public.group_events (id) on delete cascade,
  
  -- Who is responding (must be a group member)
  user_id uuid not null references auth.users (id) on delete cascade,
  member_id uuid references public.members (id) on delete set null,
  membership_id uuid not null references public.group_memberships (id) on delete cascade,
  
  -- Response
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'tentative')),
  response_note text
    constraint group_event_responses_note_length check (response_note is null or length(response_note) <= 500),
  
  -- Assignment vs invite
  is_assigned boolean not null default false,
  assigned_by uuid references auth.users (id) on delete set null,
  assigned_at timestamptz,
  
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists group_event_responses_unique_idx
  on public.group_event_responses (event_id, membership_id);

create index if not exists group_event_responses_member_idx
  on public.group_event_responses (membership_id, event_id);

create index if not exists group_event_responses_event_idx
  on public.group_event_responses (event_id, status);

-- RLS for group_event_responses
alter table public.group_event_responses enable row level security;

create policy "group_event_responses_select"
  on public.group_event_responses
  for select
  using (public.has_groups_access(church_id));

revoke all on table public.group_event_responses from public, anon;
grant select on table public.group_event_responses to authenticated;
grant all on table public.group_event_responses to service_role;

-- ---------------------------------------------------------------------------
-- SAVED LOCATIONS
-- ---------------------------------------------------------------------------

-- Church-wide location library for event address autocomplete
create table if not exists public.saved_event_locations (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  
  name text not null, -- e.g., "Main Sanctuary", "Community Center"
  full_address text not null, -- Complete formatted address
  
  -- Structured address components for matching
  street_address text,
  city text,
  state text,
  postal_code text,
  
  -- Usage tracking
  use_count integer not null default 0,
  last_used_at timestamptz,
  
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists saved_event_locations_church_idx
  on public.saved_event_locations (church_id, use_count desc, last_used_at desc nulls last);

create index if not exists saved_event_locations_search_idx
  on public.saved_event_locations using gin (
    to_tsvector('english', coalesce(name, '') || ' ' || coalesce(full_address, ''))
  );

-- RLS for saved_event_locations
alter table public.saved_event_locations enable row level security;

create policy "saved_event_locations_select"
  on public.saved_event_locations
  for select
  using (public.user_has_feature(church_id, 'announcements'));

revoke all on table public.saved_event_locations from public, anon;
grant select on table public.saved_event_locations to authenticated;
grant all on table public.saved_event_locations to service_role;

-- Function to auto-save frequently used locations
create or replace function public.record_event_location_use(
  p_church_id uuid,
  p_location text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
begin
  if p_location is null or length(btrim(p_location)) < 5 then
    return;
  end if;
  
  -- Check if this exact location already exists
  select id into v_existing
  from public.saved_event_locations
  where church_id = p_church_id
    and lower(full_address) = lower(btrim(p_location))
  limit 1;
  
  if v_existing is not null then
    -- Increment use count
    update public.saved_event_locations
    set use_count = use_count + 1,
        last_used_at = now()
    where id = v_existing;
  else
    -- Auto-save if used for the first time
    insert into public.saved_event_locations (
      church_id, name, full_address, use_count, last_used_at
    ) values (
      p_church_id,
      substring(btrim(p_location), 1, 80), -- Use first part as name
      btrim(p_location),
      1,
      now()
    ) on conflict do nothing;
  end if;
end $$;

revoke all on function public.record_event_location_use(uuid, text) from public, anon, authenticated;
grant execute on function public.record_event_location_use(uuid, text) to service_role;

notify pgrst, 'reload schema';
