-- Faithful: visitor identity, church relationships, People linkage, and campuses
-- Migration 0053 (Prompt 3)
--
-- Additive. Depends on 0050_security_baseline.sql having been applied first.
--
-- Nothing here touches an object the security baseline closed. Every policy,
-- grant and RLS statement below applies only to tables this file creates, or
-- to one nullable column added to church_service_times. The existing churches,
-- church_users, members, attendance_records and attendance_entries authorities
-- are left exactly as they are: this migration adds relationships *around*
-- them and never a second copy of them.
--
-- Rollback: every object created here is new and unreferenced by existing
-- code paths. Dropping the tables in reverse dependency order and dropping the
-- churches/church_service_times columns added at the end restores the prior
-- schema without data loss to any pre-existing table.

-- ---------------------------------------------------------------------------
-- VISITOR ACCOUNT PROFILE
-- ---------------------------------------------------------------------------
--
-- One row per credential, and deliberately thin. Supabase Auth still owns the
-- email, password and session; this table owns only what the product needs to
-- show and enforce: a display name, lifecycle, the policy versions the person
-- actually accepted, and preferences.
--
-- `authorization_version` exists for Prompt 4: any event that must invalidate a
-- cached authorization decision on a device (deactivation, blocking, link
-- revocation, deletion) bumps it, so a native client can detect staleness with
-- one integer compare instead of re-deriving permissions.

create table if not exists public.visitor_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique references auth.users (id) on delete cascade,

  display_name text,
  avatar_url text,

  status text not null default 'active'
    check (status in ('active', 'deactivated', 'deletion_requested', 'deleted')),

  -- Which version of each policy this person accepted, and when. Storing the
  -- version rather than a boolean is what makes a later policy change
  -- answerable: "who has not accepted v3" is a query, not a migration.
  terms_version text,
  terms_accepted_at timestamptz,
  privacy_version text,
  privacy_accepted_at timestamptz,

  -- Consent state only. Prompt 3 collects no location and creates no
  -- attendance; Prompt 6 reads this before it may do either. 'unset' is
  -- distinct from 'denied' on purpose — never asked is not the same as no.
  auto_attendance_consent text not null default 'unset'
    check (auto_attendance_consent in ('unset', 'granted', 'denied', 'revoked')),
  auto_attendance_consent_at timestamptz,
  auto_attendance_consent_version text,

  -- Channel preferences. No push token, topic or device row is created here;
  -- Prompt 5 owns delivery and its own installation table.
  communication_prefs jsonb not null default '{}'::jsonb,

  -- A preference, never authorization. Reading this must not imply the account
  -- still has a usable relationship with that church.
  selected_church_id uuid references public.churches (id) on delete set null,

  authorization_version integer not null default 1,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deactivated_at timestamptz,
  deletion_requested_at timestamptz
);

create index if not exists visitor_accounts_status_idx
  on public.visitor_accounts (status)
  where status <> 'active';

-- ---------------------------------------------------------------------------
-- PUBLIC CHURCH DISCOVERY CONTROLS
-- ---------------------------------------------------------------------------
--
-- Opt-in, and off by default: an existing church must not become publicly
-- listed because this migration ran. `churches.slug` already exists and is
-- already unique (0013), so it is reused as the stable public identifier
-- rather than introducing a second one that could disagree with it.

alter table public.churches
  add column if not exists is_discoverable boolean not null default false,
  add column if not exists public_summary text,
  add column if not exists join_policy text not null default 'approval_required',
  add column if not exists discovery_updated_at timestamptz,
  add column if not exists public_profile_version integer not null default 1;

do $$
begin
  alter table public.churches
    add constraint churches_join_policy_check
    check (join_policy in ('open', 'approval_required', 'invite_only'));
exception
  when duplicate_object then null;
end $$;

-- Discovery listing orders by (name, id) and filters on is_discoverable.
create index if not exists churches_discoverable_name_idx
  on public.churches (name, id)
  where is_discoverable;

-- ---------------------------------------------------------------------------
-- CAMPUSES
-- ---------------------------------------------------------------------------
--
-- A church may meet in more than one place. Coordinates and a radius are
-- stored so Prompt 6 has somewhere to read them from; nothing in Prompt 3
-- reads a device location or evaluates a geofence.

create table if not exists public.church_campuses (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,

  name text not null,
  slug text not null,

  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  country text not null default 'US',

  -- Nullable together: a campus may be configured before anyone has looked up
  -- its coordinates, but half a coordinate pair is always a bug.
  latitude numeric(9, 6) check (latitude between -90 and 90),
  longitude numeric(9, 6) check (longitude between -180 and 180),
  constraint church_campuses_coordinate_pair_check
    check ((latitude is null) = (longitude is null)),

  timezone text not null default 'America/New_York',

  -- Bounded well inside GPS noise at the low end and a city block at the high
  -- end. Prompt 6 may narrow this; it must not widen it silently.
  geofence_radius_m integer not null default 150
    check (geofence_radius_m between 25 and 2000),

  is_active boolean not null default true,
  is_public boolean not null default true,
  is_primary boolean not null default false,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (church_id, slug)
);

-- At most one primary campus per church, enforced by the database rather than
-- by whichever code path happened to write last.
create unique index if not exists church_campuses_one_primary_idx
  on public.church_campuses (church_id)
  where is_primary;

-- A stable secondary sort so campus listings do not reorder between reads.
alter table public.church_campuses
  add column if not exists sort_key integer not null default 0;

create index if not exists church_campuses_church_active_idx
  on public.church_campuses (church_id, is_active, sort_key, id)
  where is_active;

-- IANA validation. A CHECK cannot consult pg_timezone_names, so a trigger
-- does it: an invalid zone is rejected at write time rather than discovered
-- later by whatever tries to render a service time in it.
create or replace function public.validate_campus_timezone()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if not exists (
    select 1 from pg_timezone_names where name = new.timezone
  ) then
    raise exception 'invalid IANA timezone: %', new.timezone
      using errcode = 'check_violation';
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists church_campuses_validate_timezone on public.church_campuses;
create trigger church_campuses_validate_timezone
  before insert or update on public.church_campuses
  for each row execute function public.validate_campus_timezone();

-- Existing church-level service times keep working untouched; a campus may be
-- attached later. Nullable on purpose — no existing row is rewritten, and no
-- existing schedule changes meaning.
alter table public.church_service_times
  add column if not exists campus_id uuid references public.church_campuses (id) on delete set null;

create index if not exists church_service_times_campus_idx
  on public.church_service_times (campus_id)
  where campus_id is not null;

-- ---------------------------------------------------------------------------
-- VISITOR ↔ CHURCH RELATIONSHIPS
-- ---------------------------------------------------------------------------
--
-- Exactly one row per (account, church). Following a second church adds a
-- row; it never edits the first. This is not church_users and confers no
-- dashboard access of any kind.

create table if not exists public.visitor_church_relationships (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.visitor_accounts (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,

  state text not null default 'following'
    check (state in ('following', 'pending', 'joined', 'left', 'blocked')),

  -- Which policy was in force when the request was made. A church that later
  -- switches to invite_only must not retroactively invalidate the audit trail
  -- of why a pending request was created.
  join_policy_at_request text,

  invitation_id uuid,

  requested_at timestamptz,
  joined_at timestamptz,
  left_at timestamptz,
  blocked_at timestamptz,
  blocked_by uuid references auth.users (id) on delete set null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (account_id, church_id)
);

create index if not exists visitor_church_relationships_church_state_idx
  on public.visitor_church_relationships (church_id, state, created_at desc);

create index if not exists visitor_church_relationships_account_idx
  on public.visitor_church_relationships (account_id, updated_at desc);

-- Append-only transition log. Kept separate from the relationship row so a
-- state change never overwrites the record of the previous one.
create table if not exists public.visitor_relationship_events (
  id uuid primary key default gen_random_uuid(),
  relationship_id uuid references public.visitor_church_relationships (id) on delete set null,
  account_id uuid not null references public.visitor_accounts (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,

  from_state text,
  to_state text not null,
  action text not null,

  actor_type text not null check (actor_type in ('visitor', 'staff', 'system')),
  actor_user_id uuid references auth.users (id) on delete set null,
  reason text,

  created_at timestamptz not null default now()
);

create index if not exists visitor_relationship_events_church_idx
  on public.visitor_relationship_events (church_id, created_at desc);

create index if not exists visitor_relationship_events_relationship_idx
  on public.visitor_relationship_events (relationship_id, created_at desc);

-- ---------------------------------------------------------------------------
-- VISITOR INVITATIONS
-- ---------------------------------------------------------------------------
--
-- Separate from church_invites, which onboards a church administrator. Nothing
-- here can produce a church_users row.
--
-- Only the hash is stored. A leaked database backup does not yield a usable
-- invitation link.

create table if not exists public.visitor_invitations (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,

  token_hash text not null unique,

  purpose text not null check (purpose in ('join', 'people_claim')),

  -- Set only for a people_claim invitation deliberately issued for a known
  -- person. Its presence still does not link anything on its own: the token
  -- must be redeemed by an authenticated account and, for anything other than
  -- an exact staff-issued match, resolved by staff.
  member_id uuid references public.members (id) on delete set null,

  -- Who it was addressed to, for the church's own records. Never compared
  -- against the redeeming account's email to decide ownership.
  invited_email text,
  invited_label text,

  max_uses integer not null default 1 check (max_uses between 1 and 500),
  used_count integer not null default 0 check (used_count >= 0),

  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,

  accepted_at timestamptz,
  accepted_by_account_id uuid references public.visitor_accounts (id) on delete set null,

  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),

  constraint visitor_invitations_member_requires_claim_purpose
    check (member_id is null or purpose = 'people_claim')
);

create index if not exists visitor_invitations_church_idx
  on public.visitor_invitations (church_id, created_at desc);

create index if not exists visitor_invitations_open_idx
  on public.visitor_invitations (church_id, expires_at)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- PEOPLE CLAIMS AND LINKS
-- ---------------------------------------------------------------------------
--
-- members.id remains the only People identity. A claim is a request to be
-- recognised as an existing person; a link is the verified result. Neither
-- creates, merges or deletes a members row.

create table if not exists public.visitor_people_claims (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.visitor_accounts (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,

  status text not null default 'pending'
    check (status in ('pending', 'approved', 'rejected', 'withdrawn', 'disputed')),

  source text not null check (source in ('self_request', 'invitation')),
  invitation_id uuid references public.visitor_invitations (id) on delete set null,

  -- Present only when a staff-issued invitation named a specific person. A
  -- self_request may never populate this.
  requested_member_id uuid references public.members (id) on delete set null,

  -- What the claimant said about themselves. These are matching *hints* shown
  -- to authorized staff, never an automatic key. Normalized so a human sees
  -- comparable values, not so the database can join on them.
  claimed_first_name text,
  claimed_last_name text,
  normalized_email text,
  normalized_phone text,

  resolved_member_id uuid references public.members (id) on delete set null,
  resolved_by uuid references auth.users (id) on delete set null,
  resolved_at timestamptz,
  resolution_note text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint visitor_people_claims_self_request_has_no_target
    check (source = 'invitation' or requested_member_id is null)
);

-- One open claim per account per church. A second attempt updates the first
-- rather than queueing a duplicate for staff to triage.
create unique index if not exists visitor_people_claims_one_open_idx
  on public.visitor_people_claims (account_id, church_id)
  where status in ('pending', 'disputed');

create index if not exists visitor_people_claims_church_status_idx
  on public.visitor_people_claims (church_id, status, created_at desc);

create table if not exists public.visitor_people_links (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.visitor_accounts (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,
  claim_id uuid references public.visitor_people_claims (id) on delete set null,

  is_active boolean not null default true,

  linked_at timestamptz not null default now(),
  linked_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The two invariants that keep People single-valued:
-- one live account per person, and one live person per account per church.
create unique index if not exists visitor_people_links_active_member_idx
  on public.visitor_people_links (member_id)
  where is_active;

create unique index if not exists visitor_people_links_active_account_church_idx
  on public.visitor_people_links (account_id, church_id)
  where is_active;

create index if not exists visitor_people_links_church_idx
  on public.visitor_people_links (church_id, is_active, linked_at desc);

create table if not exists public.visitor_people_link_events (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  account_id uuid references public.visitor_accounts (id) on delete set null,
  claim_id uuid references public.visitor_people_claims (id) on delete set null,
  link_id uuid references public.visitor_people_links (id) on delete set null,
  member_id uuid references public.members (id) on delete set null,

  action text not null,
  from_status text,
  to_status text,

  actor_type text not null check (actor_type in ('visitor', 'staff', 'system')),
  actor_user_id uuid references auth.users (id) on delete set null,
  note text,

  created_at timestamptz not null default now()
);

create index if not exists visitor_people_link_events_church_idx
  on public.visitor_people_link_events (church_id, created_at desc);

create index if not exists visitor_people_link_events_member_idx
  on public.visitor_people_link_events (member_id, created_at desc);

-- ---------------------------------------------------------------------------
-- ACCOUNT EXPORT AND DELETION REQUESTS
-- ---------------------------------------------------------------------------

create table if not exists public.visitor_account_requests (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.visitor_accounts (id) on delete cascade,

  kind text not null check (kind in ('export', 'deletion')),
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed', 'cancelled')),

  idempotency_key text not null,

  attempts integer not null default 0,
  last_error text,

  requested_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,

  -- Export output only. A deletion request never stores a copy of what it
  -- removed.
  payload jsonb,

  unique (account_id, kind, idempotency_key)
);

-- One request of each kind in flight at a time. A double-tap on "delete my
-- account" joins the existing request instead of starting a second one.
create unique index if not exists visitor_account_requests_one_open_idx
  on public.visitor_account_requests (account_id, kind)
  where status in ('pending', 'processing');

create index if not exists visitor_account_requests_pending_idx
  on public.visitor_account_requests (status, requested_at)
  where status in ('pending', 'processing');

-- ---------------------------------------------------------------------------
-- HELPERS
-- ---------------------------------------------------------------------------
--
-- Both are SECURITY DEFINER so RLS policies can consult them, and both have
-- EXECUTE revoked from browsers for the same reason 0004 revoked the original
-- helpers: a policy helper is not a public API.

create or replace function public.current_visitor_account_id()
returns uuid
language sql
security definer
stable
set search_path = public
as $$
  select id from public.visitor_accounts where user_id = auth.uid()
$$;

-- Staff of a church, at any role. Distinct from is_church_admin: reviewing a
-- pending join request is not the same authority as changing billing.
create or replace function public.is_church_staff(target_church_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1
    from public.church_users
    where user_id = auth.uid()
      and church_id = target_church_id
  )
$$;

revoke execute on function public.current_visitor_account_id()
  from public, anon, authenticated;
revoke execute on function public.is_church_staff(uuid)
  from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- RLS: enable everywhere, then grant the narrowest workable surface
-- ---------------------------------------------------------------------------

alter table public.visitor_accounts enable row level security;
alter table public.church_campuses enable row level security;
alter table public.visitor_church_relationships enable row level security;
alter table public.visitor_relationship_events enable row level security;
alter table public.visitor_invitations enable row level security;
alter table public.visitor_people_claims enable row level security;
alter table public.visitor_people_links enable row level security;
alter table public.visitor_people_link_events enable row level security;
alter table public.visitor_account_requests enable row level security;

-- Start from nothing. Supabase grants table privileges to anon/authenticated
-- by default; every privilege below is then re-granted deliberately.
revoke all on table public.visitor_accounts from anon, authenticated;
revoke all on table public.church_campuses from anon, authenticated;
revoke all on table public.visitor_church_relationships from anon, authenticated;
revoke all on table public.visitor_relationship_events from anon, authenticated;
revoke all on table public.visitor_invitations from anon, authenticated;
revoke all on table public.visitor_people_claims from anon, authenticated;
revoke all on table public.visitor_people_links from anon, authenticated;
revoke all on table public.visitor_people_link_events from anon, authenticated;
revoke all on table public.visitor_account_requests from anon, authenticated;

grant select, insert, update on table public.visitor_accounts to authenticated;
grant select on table public.church_campuses to authenticated;
grant select on table public.visitor_church_relationships to authenticated;
grant select on table public.visitor_relationship_events to authenticated;
grant select on table public.visitor_people_links to authenticated;
grant select on table public.visitor_account_requests to authenticated;
grant select on table public.visitor_people_claims to authenticated;
grant select on table public.visitor_people_link_events to authenticated;

grant select, insert, update, delete
  on table public.visitor_accounts,
     public.church_campuses,
     public.visitor_church_relationships,
     public.visitor_relationship_events,
     public.visitor_invitations,
     public.visitor_people_claims,
     public.visitor_people_links,
     public.visitor_people_link_events,
     public.visitor_account_requests
  to service_role;

-- VISITOR ACCOUNTS: the owner, and nobody else. Staff never read this table;
-- what staff legitimately need about a claimant is projected by function.
create policy visitor_accounts_select on public.visitor_accounts
  for select to authenticated
  using (user_id = auth.uid());

create policy visitor_accounts_insert on public.visitor_accounts
  for insert to authenticated
  with check (user_id = auth.uid());

create policy visitor_accounts_update on public.visitor_accounts
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- CAMPUSES: staff read their own church's campuses. Public reads go through
-- the discovery functions, which apply the publication rules themselves.
-- Writes are admin-only and never reach a browser directly.
create policy church_campuses_select on public.church_campuses
  for select to authenticated
  using (public.is_church_staff(church_id));

-- RELATIONSHIPS: the owning visitor, or staff of that church. Writes are
-- service-role only — every transition runs through a server command that
-- validates the state machine, so there is no client insert or update policy
-- on purpose.
create policy visitor_church_relationships_select
  on public.visitor_church_relationships
  for select to authenticated
  using (
    account_id = public.current_visitor_account_id()
    or public.is_church_staff(church_id)
  );

create policy visitor_relationship_events_select
  on public.visitor_relationship_events
  for select to authenticated
  using (
    account_id = public.current_visitor_account_id()
    or public.is_church_staff(church_id)
  );

-- INVITATIONS: no policy for anon or authenticated at all. The table holds
-- token hashes and the church's outstanding invitation list; it is read and
-- written only by the service role through the consumption function below.

-- CLAIMS: staff of the church see pending work. The claimant does *not* read
-- this table — a claim row carries requested_member_id and resolved_member_id,
-- and RLS cannot redact a column. Visitors read their own status through
-- visitor_claim_status(), which returns state without People identifiers.
create policy visitor_people_claims_select on public.visitor_people_claims
  for select to authenticated
  using (public.is_church_staff(church_id));

-- LINKS: staff of the church, and the linked account. An active link means
-- that members row *is* this person, so seeing their own member_id discloses
-- nothing they should not already know.
create policy visitor_people_links_select on public.visitor_people_links
  for select to authenticated
  using (
    account_id = public.current_visitor_account_id()
    or public.is_church_staff(church_id)
  );

create policy visitor_people_link_events_select
  on public.visitor_people_link_events
  for select to authenticated
  using (public.is_church_staff(church_id));

-- ACCOUNT REQUESTS: owner only.
create policy visitor_account_requests_select
  on public.visitor_account_requests
  for select to authenticated
  using (account_id = public.current_visitor_account_id());

-- ---------------------------------------------------------------------------
-- PUBLIC DISCOVERY PROJECTION
-- ---------------------------------------------------------------------------
--
-- These functions are the only way a non-staff caller reaches church data.
-- They are SECURITY DEFINER and enumerate their output columns explicitly, so
-- adding a private column to `churches` later cannot widen them by accident.
-- Neither returns the church's internal id: the slug is the public handle.

create or replace function public.discover_churches(
  p_query text default null,
  p_state text default null,
  p_postal_code text default null,
  p_cursor_name text default null,
  p_cursor_id uuid default null,
  p_limit integer default 20
)
returns table (
  slug text,
  name text,
  logo_url text,
  public_summary text,
  denomination text,
  city text,
  state text,
  postal_code text,
  website text,
  join_policy text,
  public_profile_version integer,
  cursor_name text,
  cursor_id uuid
)
language sql
security definer
stable
set search_path = public
as $$
  select
    c.slug,
    c.name,
    c.logo_url,
    c.public_summary,
    c.denomination,
    c.city,
    c.state,
    c.zip as postal_code,
    c.website,
    c.join_policy,
    c.public_profile_version,
    c.name as cursor_name,
    c.id as cursor_id
  from public.churches c
  where c.is_discoverable
    and c.slug is not null
    and (p_query is null or c.name ilike '%' || p_query || '%')
    and (p_state is null or lower(c.state) = lower(p_state))
    and (p_postal_code is null or c.zip = p_postal_code)
    -- Keyset pagination on the same (name, id) the index is built for. Stable
    -- across inserts in a way OFFSET is not.
    and (
      p_cursor_name is null
      or p_cursor_id is null
      or (c.name, c.id) > (p_cursor_name, p_cursor_id)
    )
  order by c.name, c.id
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

create or replace function public.public_church_profile(p_slug text)
returns table (
  slug text,
  name text,
  logo_url text,
  cover_image_url text,
  public_summary text,
  tagline text,
  denomination text,
  address text,
  city text,
  state text,
  postal_code text,
  website text,
  phone text,
  email text,
  join_policy text,
  timezone text,
  public_profile_version integer
)
language sql
security definer
stable
set search_path = public
as $$
  select
    c.slug, c.name, c.logo_url, c.cover_image_url, c.public_summary,
    c.tagline, c.denomination, c.address, c.city, c.state, c.zip,
    c.website, c.phone, c.email, c.join_policy, c.timezone,
    c.public_profile_version
  from public.churches c
  where c.is_discoverable
    and c.slug is not null
    and c.slug = p_slug
$$;

-- Campuses and service times for a discoverable church. Public campuses only,
-- and the geofence radius is deliberately not returned: it is operational
-- configuration for Prompt 6, not public information.
create or replace function public.public_church_campuses(p_slug text)
returns table (
  campus_slug text,
  name text,
  address_line1 text,
  address_line2 text,
  city text,
  state text,
  postal_code text,
  latitude numeric,
  longitude numeric,
  timezone text,
  is_primary boolean,
  service_label text,
  service_day_of_week smallint,
  service_start_time time,
  service_kind text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    cc.slug,
    cc.name,
    cc.address_line1,
    cc.address_line2,
    cc.city,
    cc.state,
    cc.postal_code,
    cc.latitude,
    cc.longitude,
    cc.timezone,
    cc.is_primary,
    st.label,
    st.day_of_week,
    st.start_time,
    st.kind
  from public.churches c
  join public.church_campuses cc on cc.church_id = c.id
  left join public.church_service_times st on st.campus_id = cc.id
  where c.is_discoverable
    and c.slug = p_slug
    and cc.is_active
    and cc.is_public
  order by cc.is_primary desc, cc.sort_key, cc.id, st.sort_order
$$;

-- Anonymous discovery is the point: someone evaluating a church has not
-- signed in yet.
grant execute on function
  public.discover_churches(text, text, text, text, uuid, integer)
  to anon, authenticated;
grant execute on function public.public_church_profile(text)
  to anon, authenticated;
grant execute on function public.public_church_campuses(text)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- VISITOR-FACING CLAIM STATUS
-- ---------------------------------------------------------------------------
--
-- What the claimant is allowed to know: whether their claim is still open, and
-- how it was decided. Never which People record was considered or matched.

create or replace function public.visitor_claim_status(p_church_slug text)
returns table (
  status text,
  source text,
  created_at timestamptz,
  resolved_at timestamptz,
  is_linked boolean
)
language sql
security definer
stable
set search_path = public
as $$
  select
    cl.status,
    cl.source,
    cl.created_at,
    cl.resolved_at,
    exists (
      select 1
      from public.visitor_people_links l
      where l.account_id = cl.account_id
        and l.church_id = cl.church_id
        and l.is_active
    ) as is_linked
  from public.visitor_people_claims cl
  join public.churches c on c.id = cl.church_id
  where c.slug = p_church_slug
    and cl.account_id = public.current_visitor_account_id()
  order by cl.created_at desc
  limit 1
$$;

grant execute on function public.visitor_claim_status(text) to authenticated;

-- ---------------------------------------------------------------------------
-- ATOMIC INVITATION CONSUMPTION
-- ---------------------------------------------------------------------------
--
-- One statement decides validity and consumption together. Two devices
-- redeeming the same single-use link race into the same row lock, and exactly
-- one of them wins.
--
-- A blocked relationship refuses redemption here rather than in application
-- code, so replaying an older invitation cannot restore access.

create or replace function public.consume_visitor_invitation(
  p_token_hash text,
  p_account_id uuid,
  p_purpose text,
  p_now timestamptz default now()
)
returns table (
  ok boolean,
  reason text,
  invitation_id uuid,
  church_id uuid,
  member_id uuid
)
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  invite public.visitor_invitations%rowtype;
  blocked boolean;
begin
  select * into invite
  from public.visitor_invitations
  where token_hash = p_token_hash
  for update;

  if not found then
    return query select false, 'not_found', null::uuid, null::uuid, null::uuid;
    return;
  end if;

  if invite.purpose is distinct from p_purpose then
    return query select false, 'wrong_purpose', null::uuid, null::uuid, null::uuid;
    return;
  end if;

  if invite.revoked_at is not null then
    return query select false, 'revoked', null::uuid, null::uuid, null::uuid;
    return;
  end if;

  if invite.expires_at <= p_now then
    return query select false, 'expired', null::uuid, null::uuid, null::uuid;
    return;
  end if;

  if invite.used_count >= invite.max_uses then
    return query select false, 'exhausted', null::uuid, null::uuid, null::uuid;
    return;
  end if;

  select (r.state = 'blocked') into blocked
  from public.visitor_church_relationships r
  where r.account_id = p_account_id
    and r.church_id = invite.church_id;

  if coalesce(blocked, false) then
    return query select false, 'blocked', null::uuid, null::uuid, null::uuid;
    return;
  end if;

  update public.visitor_invitations
     set used_count = used_count + 1,
         accepted_at = coalesce(accepted_at, p_now),
         accepted_by_account_id = coalesce(accepted_by_account_id, p_account_id)
   where id = invite.id;

  return query
    select true, 'ok', invite.id, invite.church_id, invite.member_id;
end;
$$;

revoke all on function
  public.consume_visitor_invitation(text, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.consume_visitor_invitation(text, uuid, text, timestamptz)
  to service_role;

notify pgrst, 'reload schema';
