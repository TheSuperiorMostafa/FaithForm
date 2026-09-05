-- Households, locations, and children's check-in
-- Migration 0071
--
-- ## The two problems, and why they are one migration
--
-- Staff look people up one at a time because the data model has no idea a
-- family exists. And FaithForm cannot check a child in at all. These look
-- separate until you write down what a checkout actually is: a credential held
-- by *a household* authorising release of *a child in that household* to an
-- adult who belongs to it. Without households there is nothing to hang the
-- credential on, so the directory is not a nice-to-have alongside check-in —
-- it is the thing check-in is built out of.
--
-- ## Locations are not an age-tier system
--
-- Every church structures children's ministry differently and every one of them
-- is sure their structure is the obvious one. So nothing here ships a taxonomy.
-- A location is a named place a person can be assigned to; "Nursery" and
-- "Middle School Overflow Room" are the same kind of object, both created by an
-- admin, and the platform has no opinion about either. That also means the same
-- primitive answers "where is my child" and "where is the parent who is serving
-- this morning" without a second system.
--
-- ## What is deliberately not here
--
-- No `checkout` path that a parent can reach. The app can create and read a
-- check-in; releasing a child is a staff action against a presented
-- credential, and the absence of a parent-facing release path is a safety
-- property of the schema, not a UI decision that could be revisited in a
-- component.
--
-- QR credentials are signed tokens, not rows: they carry their own expiry and
-- there is nothing to leak. Six-digit codes *are* rows, because six digits
-- collide — two households drawing 418 302 in the same week would hand a staff
-- member an ambiguous match, and only a unique index can prevent that.

-- ---------------------------------------------------------------------------
-- LOCATIONS
-- ---------------------------------------------------------------------------

create table if not exists public.church_locations (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,

  name text not null,
  description text,

  -- Admin-controlled ordering. Rooms have a natural order to the people who
  -- work in them (youngest first, or by corridor) and alphabetical is not it.
  sort_order integer not null default 0,

  -- Rooms have legal occupancy limits. Advisory here: the roster shows it,
  -- nothing blocks on it, because a volunteer turning a family away at the
  -- door over a number in a database is worse than being one over.
  capacity integer check (capacity is null or capacity > 0),

  -- Where an adult goes unless someone says otherwise — "Sanctuary" for most
  -- churches. A default, not a category: it is a location like any other.
  is_default_adult_location boolean not null default false,

  is_active boolean not null default true,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

-- Two rooms called "Nursery" in one church is always a mistake, and always one
-- discovered at the moment it matters least.
create unique index if not exists church_locations_name_idx
  on public.church_locations (church_id, lower(name));

create index if not exists church_locations_active_idx
  on public.church_locations (church_id, sort_order, name)
  where is_active;

create unique index if not exists church_locations_default_adult_idx
  on public.church_locations (church_id)
  where is_default_adult_location;

-- ---------------------------------------------------------------------------
-- HOUSEHOLDS
-- ---------------------------------------------------------------------------

create table if not exists public.households (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,

  -- "The Doe Household". Free text, because family names are not a function of
  -- their members' surnames and guessing one wrong in front of a family is a
  -- small, avoidable unkindness.
  name text not null,

  notes text,

  -- Bumped when a household's codes must stop working before the week is out —
  -- a lost phone, a custody change. Folded into code generation so the next
  -- issue differs from the last.
  code_rotation integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

create index if not exists households_church_idx
  on public.households (church_id, name);

create table if not exists public.household_members (
  id uuid primary key default gen_random_uuid(),

  -- Denormalized from the household so every policy on this table is a
  -- membership check rather than a join through a table with its own.
  church_id uuid not null references public.churches (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,

  -- `guardian` is an authorization, not a description: it is what makes
  -- someone able to hold a credential for this household's children.
  -- `dependent` is who may be checked in under it. `other` is an adult who
  -- lives here and neither collects nor is collected.
  relationship text not null
    check (relationship in ('guardian', 'dependent', 'other')),

  -- What to call it on screen — "Mother", "Grandson", "Foster child". Never
  -- read as authorization; `relationship` above is.
  relationship_label text,

  is_primary_contact boolean not null default false,

  created_at timestamptz not null default now(),
  created_by uuid references auth.users (id) on delete set null
);

-- A person belongs to exactly one household. Two households claiming the same
-- child is precisely the ambiguity a custody chain must not contain — the
-- answer for a grandparent or a separated parent is an explicit pickup
-- authorization below, which is auditable, and not a second membership, which
-- is not.
create unique index if not exists household_members_person_idx
  on public.household_members (member_id);

create index if not exists household_members_household_idx
  on public.household_members (household_id, relationship);

create unique index if not exists household_members_primary_contact_idx
  on public.household_members (household_id)
  where is_primary_contact;

-- ---------------------------------------------------------------------------
-- ALTERNATE PICKUP
-- ---------------------------------------------------------------------------
--
-- A grandparent who does not live here and is not a guardian, but whom this
-- family has said may collect their children. Named explicitly and revocably,
-- because the alternative churches actually use is a volunteer remembering a
-- face.

create table if not exists public.household_pickup_authorizations (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,

  -- Must be a person the church already knows. An authorization naming a
  -- stranger is not one anybody could check at the door.
  member_id uuid not null references public.members (id) on delete cascade,

  relationship_label text,

  is_active boolean not null default true,
  authorized_at timestamptz not null default now(),
  authorized_by uuid references auth.users (id) on delete set null,
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null,
  revoke_reason text
);

create unique index if not exists household_pickup_active_idx
  on public.household_pickup_authorizations (household_id, member_id)
  where is_active;

-- ---------------------------------------------------------------------------
-- WEEKLY CHECKOUT CODES
-- ---------------------------------------------------------------------------
--
-- One code per household per service week, spoken aloud at a desk by a parent
-- who could not open their phone. Stored rather than derived so that the
-- uniqueness a staff member depends on — "this code identifies exactly one
-- family" — is enforced by the database instead of hoped for.
--
-- Held in plaintext on purpose: a code that cannot be shown to the parent who
-- must read it out is not a code. The mitigations are that it is worthless
-- without a staff member standing there, it expires within the week, and the
-- table is readable only by the church it belongs to.

create table if not exists public.household_checkout_codes (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  household_id uuid not null references public.households (id) on delete cascade,

  -- The church-local Sunday that starts the service week this code covers.
  week_start date not null,

  code text not null check (code ~ '^[0-9]{6}$'),

  issued_at timestamptz not null default now(),
  revoked_at timestamptz,
  revoked_by uuid references auth.users (id) on delete set null
);

-- The property the checkout desk relies on: within one church and one week, a
-- code names one household and no other.
create unique index if not exists household_checkout_codes_unique_idx
  on public.household_checkout_codes (church_id, week_start, code)
  where revoked_at is null;

create unique index if not exists household_checkout_codes_household_idx
  on public.household_checkout_codes (household_id, week_start)
  where revoked_at is null;

-- ---------------------------------------------------------------------------
-- CHECK-IN SESSIONS
-- ---------------------------------------------------------------------------
--
-- Not to be confused with `attendance_checkin_sessions` (0059), which is a
-- projector showing a rotating code to a congregation. This is one person, in
-- one room, for one service — the row a volunteer means when they ask who is
-- in their room right now.
--
-- Adults are in this table too. A parent serving in the nursery is checked in
-- to the nursery by exactly the same mechanism as the children there, which is
-- what makes "where is this person right now" answerable at all.

create table if not exists public.checkin_sessions (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,

  member_id uuid not null references public.members (id) on delete cascade,

  -- Captured at check-in rather than joined at read time. A household can be
  -- restructured on Monday; the Sunday record must still say who was entitled
  -- to collect this child that morning.
  household_id uuid references public.households (id) on delete set null,

  -- Deleting a room with history is refused. The dashboard checks first and
  -- offers to deactivate instead, which is what the person actually wanted.
  location_id uuid not null references public.church_locations (id)
    on delete restrict,

  -- Null when a church checks people in outside a generated occurrence, which
  -- happens for midweek programmes and every church's first Sunday on the
  -- platform. `local_service_date` is therefore the authority for "which
  -- Sunday", and is what the weekly stats group by.
  service_occurrence_id uuid references public.service_occurrences (id)
    on delete set null,
  local_service_date date not null,

  status text not null default 'checked_in'
    check (status in ('pre_checked_in', 'checked_in', 'checked_out', 'cancelled')),

  -- Pre-check-in is the parent saying "we are coming"; it is not custody.
  -- Custody starts at `checked_in_at`, when a staff member physically received
  -- the child, and the two timestamps are kept apart so the difference is
  -- always visible.
  pre_checked_in_at timestamptz,
  pre_checked_in_by_account_id uuid
    references public.visitor_accounts (id) on delete set null,

  checked_in_at timestamptz,
  checked_in_by uuid references auth.users (id) on delete set null,
  checkin_method text
    check (checkin_method is null or checkin_method in ('app', 'kiosk', 'staff')),

  checked_out_at timestamptz,
  checked_out_by uuid references auth.users (id) on delete set null,

  -- Which credential the staff member actually verified. `override` is the
  -- lost-phone path and is the reason this column is not a boolean: an
  -- override has to be countable and reviewable afterwards.
  checkout_method text
    check (checkout_method is null or checkout_method in ('qr', 'code', 'override')),
  checkout_released_to_member_id uuid
    references public.members (id) on delete set null,
  checkout_override_reason text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- An override with no reason recorded is the failure mode this whole feature
  -- exists to prevent, so it is refused at the column rather than in a form.
  constraint checkin_sessions_override_needs_reason
    check (
      checkout_method is distinct from 'override'
      or (checkout_override_reason is not null
          and length(btrim(checkout_override_reason)) > 0)
    ),

  constraint checkin_sessions_checked_out_has_time
    check ((status = 'checked_out') = (checked_out_at is not null))
);

-- One open session per person per service day. This is what makes double
-- check-in impossible, and it is an index rather than a check-then-insert
-- because two volunteers on two iPads is the ordinary case, not the rare one.
create unique index if not exists checkin_sessions_open_idx
  on public.checkin_sessions (member_id, local_service_date)
  where status in ('pre_checked_in', 'checked_in');

-- The live roster: one room, right now.
create index if not exists checkin_sessions_roster_idx
  on public.checkin_sessions (church_id, local_service_date, location_id, status);

-- Week-over-week headcounts per location.
create index if not exists checkin_sessions_stats_idx
  on public.checkin_sessions (church_id, location_id, local_service_date);

-- "Where is my child" and a person's own history.
create index if not exists checkin_sessions_member_idx
  on public.checkin_sessions (member_id, local_service_date desc);

create index if not exists checkin_sessions_household_idx
  on public.checkin_sessions (household_id, local_service_date desc);

-- ---------------------------------------------------------------------------
-- PERSON PROFILE
-- ---------------------------------------------------------------------------
--
-- Both of these are on every person, not only on children. A volunteer's
-- background check and an adult's severe allergy are the same shape of fact as
-- a four-year-old's, and scoping them to children would mean building the
-- general version again the first time someone asked.

alter table public.members
  add column if not exists medical_notes text,
  add column if not exists default_location_id uuid
    references public.church_locations (id) on delete set null;

-- ---------------------------------------------------------------------------
-- PERSON FILES
-- ---------------------------------------------------------------------------
--
-- Background checks and signed waivers. The default is admin-only and it is
-- the default on purpose: "visible to all staff" is indefensible for a
-- document that says whether a volunteer has a criminal record, and a default
-- that has to be tightened after the fact never is.

create table if not exists public.member_files (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  member_id uuid not null references public.members (id) on delete cascade,

  -- `<church_id>/<member_id>/<uuid>.<ext>` in the member-files bucket. Unique
  -- so a retried upload cannot leave two rows pointing at one object.
  storage_path text not null unique,

  label text not null,
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,

  visibility text not null default 'church_admin'
    check (visibility in ('church_admin', 'staff')),

  -- Captured at upload. A staff member can be removed from a church; the file
  -- still has to say who put it there.
  uploaded_by uuid references auth.users (id) on delete set null,
  uploaded_by_name text,

  -- For the documents that go stale — a background check due to be re-run.
  expires_on date,

  created_at timestamptz not null default now()
);

create index if not exists member_files_member_idx
  on public.member_files (member_id, created_at desc);

create index if not exists member_files_expiry_idx
  on public.member_files (church_id, expires_on)
  where expires_on is not null;

-- ---------------------------------------------------------------------------
-- UPDATED_AT
-- ---------------------------------------------------------------------------

create or replace function public.set_checkin_tables_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists church_locations_updated_at on public.church_locations;
create trigger church_locations_updated_at
  before update on public.church_locations
  for each row execute function public.set_checkin_tables_updated_at();

drop trigger if exists households_updated_at on public.households;
create trigger households_updated_at
  before update on public.households
  for each row execute function public.set_checkin_tables_updated_at();

drop trigger if exists checkin_sessions_updated_at on public.checkin_sessions;
create trigger checkin_sessions_updated_at
  before update on public.checkin_sessions
  for each row execute function public.set_checkin_tables_updated_at();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
--
-- Reads are scoped to the church. Every write goes through a server action
-- holding the service role, which is also what decides whether a release was
-- authorised — a church member must never be able to write a checkout row
-- directly, credential or not.

alter table public.church_locations enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.household_pickup_authorizations enable row level security;
alter table public.household_checkout_codes enable row level security;
alter table public.checkin_sessions enable row level security;
alter table public.member_files enable row level security;

drop policy if exists church_locations_select on public.church_locations;
create policy church_locations_select on public.church_locations
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

drop policy if exists households_select on public.households;
create policy households_select on public.households
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

drop policy if exists household_members_select on public.household_members;
create policy household_members_select on public.household_members
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

drop policy if exists household_pickup_select on public.household_pickup_authorizations;
create policy household_pickup_select on public.household_pickup_authorizations
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

drop policy if exists checkin_sessions_select on public.checkin_sessions;
create policy checkin_sessions_select on public.checkin_sessions
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

-- Codes are not shown in the dashboard at all — staff type one in, they never
-- read one out — so nothing in the church's own session needs to select them.
-- Only the service role, verifying a code a parent presented, ever reads here.

-- A background check is admin-only unless someone deliberately marked a file
-- as staff-visible. Note this is the *account-holder's* own admin role, not a
-- platform admin: `is_church_admin` asks about the church in the row.
drop policy if exists member_files_select on public.member_files;
create policy member_files_select on public.member_files
  for select to authenticated
  using (
    church_id in (select public.user_church_ids())
    and (visibility = 'staff' or public.is_church_admin(church_id))
  );

revoke insert, update, delete on table public.church_locations from public, anon, authenticated;
revoke insert, update, delete on table public.households from public, anon, authenticated;
revoke insert, update, delete on table public.household_members from public, anon, authenticated;
revoke insert, update, delete on table public.household_pickup_authorizations from public, anon, authenticated;
revoke select, insert, update, delete on table public.household_checkout_codes from public, anon, authenticated;
revoke insert, update, delete on table public.checkin_sessions from public, anon, authenticated;
revoke insert, update, delete on table public.member_files from public, anon, authenticated;

grant select, insert, update, delete on table public.church_locations to service_role;
grant select, insert, update, delete on table public.households to service_role;
grant select, insert, update, delete on table public.household_members to service_role;
grant select, insert, update, delete on table public.household_pickup_authorizations to service_role;
grant select, insert, update, delete on table public.household_checkout_codes to service_role;
grant select, insert, update, delete on table public.checkin_sessions to service_role;
grant select, insert, update, delete on table public.member_files to service_role;

notify pgrst, 'reload schema';
