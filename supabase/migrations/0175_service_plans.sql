-- Migration 0175: Service Plans
--
-- A church's order of service: service types (Sunday Morning), dated plans and
-- templates, the ordered items in each plan, who leads them, notes by
-- category, teams and positions, a church-owned song library with
-- arrangements, and read-only share links.
--
-- ## Shape
--
--   service_types ─┬─ service_type_times        default times (Sun 9:00 service)
--                  ├─ teams ── team_positions    Worship > Keys, Tech > Sound
--                  │      └── team_note_categories  which note categories a team sees
--                  └─ plans (dated, or is_template)
--                       ├─ plan_times            actual times for this date
--                       ├─ plan_items            ordered by a fractional `position`
--                       │    └─ plan_item_leaders   a person or an open position
--                       ├─ plan_notes            plan- or item-level, by category
--                       ├─ plan_team_members     who serves on this date
--                       └─ plan_shares           one row per recipient link
--   songs ── song_arrangements ── song_attachments
--
-- Start times are never stored: they are derived from the chosen plan time plus
-- the lengths of every earlier non-header item (lib/service-plans/timing.ts),
-- so the screen, the PDF and share pages cannot disagree.
--
-- ## Tenancy
--
-- Every table carries church_id. Children reference parents through composite
-- (id, church_id) keys, so a row can never point at another church's row even
-- through the service role. References into `members` (an older table without
-- a composite key) are checked by trigger instead.
--
-- ## Access
--
-- Staff who hold the Service Plans feature read their own church through RLS
-- (and so through Realtime). No browser role writes anything: every mutation is
-- a server action that authorises the caller, then writes with the service
-- role. Share-link holders never touch these tables; a route handler checks the
-- hashed token and returns only what that preset allows. Token hashes are not
-- readable by any browser role.
--
-- The feature ships OFF: a church sees Service Plans only once a platform admin
-- switches it on (dev environment and one founding church first).
--
-- Additive. No existing table is altered; rollback is dropping these objects in
-- reverse order and the `song-files` bucket.

-- ---------------------------------------------------------------------------
-- ACCESS HELPER
-- ---------------------------------------------------------------------------

create or replace function public.has_service_plans_access(target_church_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  -- Default off: an account needs an explicit enabled switch, unlike features
  -- that ship on (church_feature_enabled treats a missing row as on).
  select exists (
      select 1 from public.church_features f
      where f.church_id = target_church_id
        and f.feature_key = 'service_plans'
        and f.enabled
    )
    and public.user_has_feature(target_church_id, 'service_plans')
$$;

revoke all on function public.has_service_plans_access(uuid) from public, anon;
grant execute on function public.has_service_plans_access(uuid) to authenticated, service_role;

create or replace function public.service_plans_touch()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- SERVICE TYPES
-- ---------------------------------------------------------------------------

create table if not exists public.service_types (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  name text not null
    constraint service_types_name_length check (length(btrim(name)) between 1 and 80),
  -- 0 = Sunday … 6 = Saturday; the date picker defaults to the next one.
  default_weekday smallint
    constraint service_types_weekday_range check (default_weekday between 0 and 6),
  target_seconds integer
    constraint service_types_target_range check (target_seconds is null or target_seconds between 60 and 86400),
  -- Set after plans exists (circular reference), below.
  default_template_id uuid,
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_types_id_church_key unique (id, church_id)
);

create index if not exists service_types_church_idx
  on public.service_types (church_id, sort_order, name)
  where archived_at is null;

create table if not exists public.service_type_times (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  service_type_id uuid not null,
  kind text not null default 'service'
    constraint service_type_times_kind_check check (kind in ('service', 'rehearsal', 'other')),
  label text not null
    constraint service_type_times_label_length check (length(btrim(label)) between 1 and 60),
  weekday smallint not null
    constraint service_type_times_weekday_range check (weekday between 0 and 6),
  local_time time not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  foreign key (service_type_id, church_id)
    references public.service_types (id, church_id) on delete cascade
);

create index if not exists service_type_times_type_idx
  on public.service_type_times (service_type_id, sort_order);

-- ---------------------------------------------------------------------------
-- TEAMS AND POSITIONS
-- ---------------------------------------------------------------------------

create table if not exists public.teams (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  service_type_id uuid not null,
  name text not null
    constraint teams_name_length check (length(btrim(name)) between 1 and 60),
  sort_order integer not null default 0,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint teams_id_church_key unique (id, church_id),
  foreign key (service_type_id, church_id)
    references public.service_types (id, church_id) on delete cascade
);

create index if not exists teams_type_idx
  on public.teams (service_type_id, sort_order)
  where archived_at is null;

create table if not exists public.team_positions (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  team_id uuid not null,
  name text not null
    constraint team_positions_name_length check (length(btrim(name)) between 1 and 60),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint team_positions_id_church_key unique (id, church_id),
  foreign key (team_id, church_id)
    references public.teams (id, church_id) on delete cascade
);

create index if not exists team_positions_team_idx
  on public.team_positions (team_id, sort_order);

-- Which note categories a team sees by default. Set once per service type on
-- the Teams tab; a share can override it.
create table if not exists public.team_note_categories (
  church_id uuid not null,
  team_id uuid not null,
  category text not null
    constraint team_note_categories_category_check
      check (category in ('general', 'tech', 'worship', 'slides')),
  primary key (team_id, category),
  foreign key (team_id, church_id)
    references public.teams (id, church_id) on delete cascade
);

-- ---------------------------------------------------------------------------
-- SONG LIBRARY
-- ---------------------------------------------------------------------------
--
-- The church's own database, fed by hand entry and file import. A CCLI source
-- can be added behind lib/service-plans/songs/source.ts without touching this.

create table if not exists public.songs (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  title text not null
    constraint songs_title_length check (length(btrim(title)) between 1 and 200),
  author text
    constraint songs_author_length check (author is null or length(author) <= 300),
  ccli_number text
    constraint songs_ccli_format check (ccli_number is null or ccli_number ~ '^[0-9]{1,10}$'),
  copyright text
    constraint songs_copyright_length check (copyright is null or length(copyright) <= 500),
  default_key text
    constraint songs_key_length check (default_key is null or length(default_key) <= 8),
  tempo integer
    constraint songs_tempo_range check (tempo is null or tempo between 20 and 300),
  tags text[] not null default '{}',
  themes text[] not null default '{}',
  -- Where the row came from, so the import review and support can tell.
  source text not null default 'manual'
    constraint songs_source_check check (source in ('manual', 'chordpro', 'onsong', 'songselect', 'csv', 'starter')),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint songs_id_church_key unique (id, church_id)
);

create index if not exists songs_church_title_idx
  on public.songs (church_id, lower(title))
  where archived_at is null;
create index if not exists songs_church_ccli_idx
  on public.songs (church_id, ccli_number)
  where ccli_number is not null;

create table if not exists public.song_arrangements (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  song_id uuid not null,
  name text not null default 'Default'
    constraint song_arrangements_name_length check (length(btrim(name)) between 1 and 80),
  key text
    constraint song_arrangements_key_length check (key is null or length(key) <= 8),
  bpm integer
    constraint song_arrangements_bpm_range check (bpm is null or bpm between 20 and 300),
  length_seconds integer
    constraint song_arrangements_length_range check (length_seconds is null or length_seconds between 0 and 7200),
  -- e.g. {Verse 1, Chorus, Verse 2, Chorus, Bridge, Chorus}
  section_order text[] not null default '{}',
  chart_text text
    constraint song_arrangements_chart_length check (chart_text is null or length(chart_text) <= 100000),
  lyrics text
    constraint song_arrangements_lyrics_length check (lyrics is null or length(lyrics) <= 100000),
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint song_arrangements_id_church_key unique (id, church_id),
  foreign key (song_id, church_id)
    references public.songs (id, church_id) on delete cascade
);

create index if not exists song_arrangements_song_idx
  on public.song_arrangements (song_id, sort_order);

create table if not exists public.song_attachments (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  arrangement_id uuid not null,
  kind text not null
    constraint song_attachments_kind_check check (kind in ('chart_pdf', 'audio_link', 'file')),
  -- A file in the private `song-files` bucket under <church_id>/…, or a link.
  storage_path text
    constraint song_attachments_path_length check (storage_path is null or length(storage_path) <= 500),
  url text
    constraint song_attachments_url_check check (url is null or (url ~* '^https://' and length(url) <= 2048)),
  file_name text
    constraint song_attachments_file_name_length check (file_name is null or length(file_name) <= 255),
  created_at timestamptz not null default now(),
  constraint song_attachments_has_target check ((storage_path is null) <> (url is null)),
  constraint song_attachments_path_church check (storage_path is null or storage_path like church_id::text || '/%'),
  foreign key (arrangement_id, church_id)
    references public.song_arrangements (id, church_id) on delete cascade
);

create index if not exists song_attachments_arrangement_idx
  on public.song_attachments (arrangement_id);

-- ---------------------------------------------------------------------------
-- PLANS AND TEMPLATES
-- ---------------------------------------------------------------------------

create table if not exists public.plans (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  service_type_id uuid not null,
  -- Null only for templates.
  plan_date date,
  title text
    constraint plans_title_length check (title is null or length(title) <= 120),
  series text
    constraint plans_series_length check (series is null or length(series) <= 120),
  is_template boolean not null default false,
  -- Bumped by trigger on every change a share recipient could see.
  share_version integer not null default 1,
  created_by uuid references auth.users (id) on delete set null,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plans_id_church_key unique (id, church_id),
  constraint plans_dated_unless_template check (is_template or plan_date is not null),
  constraint plans_template_named check (not is_template or length(btrim(coalesce(title, ''))) > 0),
  foreign key (service_type_id, church_id)
    references public.service_types (id, church_id) on delete cascade
);

create index if not exists plans_type_date_idx
  on public.plans (service_type_id, plan_date desc)
  where not is_template;
create index if not exists plans_church_date_idx
  on public.plans (church_id, plan_date)
  where not is_template;
create index if not exists plans_type_templates_idx
  on public.plans (service_type_id, title)
  where is_template;

alter table public.service_types
  drop constraint if exists service_types_default_template_fkey;
alter table public.service_types
  add constraint service_types_default_template_fkey
  foreign key (default_template_id, church_id)
  references public.plans (id, church_id) on delete set null (default_template_id);

create table if not exists public.plan_times (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  plan_id uuid not null,
  kind text not null default 'service'
    constraint plan_times_kind_check check (kind in ('service', 'rehearsal', 'other')),
  label text not null
    constraint plan_times_label_length check (length(btrim(label)) between 1 and 60),
  starts_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (plan_id, church_id)
    references public.plans (id, church_id) on delete cascade
);

create index if not exists plan_times_plan_idx
  on public.plan_times (plan_id, starts_at);

-- ---------------------------------------------------------------------------
-- PLAN ITEMS
-- ---------------------------------------------------------------------------

create table if not exists public.plan_items (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  plan_id uuid not null,
  -- Fractional index (base-62 key). A drag writes one row. Byte ordering is
  -- what the keys are generated for, so the column sorts with the C collation.
  position text collate "C" not null
    constraint plan_items_position_format check (position ~ '^[0-9A-Za-z]{1,200}$'),
  item_type text not null default 'item'
    constraint plan_items_type_check check (item_type in ('item', 'song', 'header', 'media')),
  title text not null
    constraint plan_items_title_length check (length(btrim(title)) between 1 and 200),
  -- Headers group items and carry no length of their own.
  length_seconds integer not null default 0
    constraint plan_items_length_range check (length_seconds between 0 and 86400),
  description text
    constraint plan_items_description_length check (description is null or length(description) <= 4000),
  song_id uuid,
  arrangement_id uuid,
  song_key text
    constraint plan_items_song_key_length check (song_key is null or length(song_key) <= 8),
  media_url text
    constraint plan_items_media_url_check check (media_url is null or (media_url ~* '^https://' and length(media_url) <= 2048)),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  -- Soft delete: undo from the toast, restore for 30 days.
  deleted_at timestamptz,
  constraint plan_items_id_church_key unique (id, church_id),
  constraint plan_items_id_plan_church_key unique (id, plan_id, church_id),
  constraint plan_items_header_no_length check (item_type <> 'header' or length_seconds = 0),
  foreign key (plan_id, church_id)
    references public.plans (id, church_id) on delete cascade,
  foreign key (song_id, church_id)
    references public.songs (id, church_id) on delete set null (song_id),
  foreign key (arrangement_id, church_id)
    references public.song_arrangements (id, church_id) on delete set null (arrangement_id)
);

-- Two planners inserting at the same spot can compute the same key; the second
-- write fails here and the action retries with a fresh key.
create unique index if not exists plan_items_plan_position_idx
  on public.plan_items (plan_id, position)
  where deleted_at is null;
create index if not exists plan_items_song_idx
  on public.plan_items (church_id, song_id)
  where song_id is not null and deleted_at is null;
create index if not exists plan_items_deleted_idx
  on public.plan_items (church_id, deleted_at)
  where deleted_at is not null;

create table if not exists public.plan_item_leaders (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  plan_id uuid not null,
  plan_item_id uuid not null,
  person_id uuid references public.members (id) on delete cascade,
  -- An open slot: shown as a dashed chip until someone fills it.
  team_position_id uuid,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  constraint plan_item_leaders_target check (person_id is not null or team_position_id is not null),
  foreign key (plan_item_id, plan_id, church_id)
    references public.plan_items (id, plan_id, church_id) on delete cascade,
  foreign key (team_position_id, church_id)
    references public.team_positions (id, church_id) on delete cascade
);

create index if not exists plan_item_leaders_item_idx
  on public.plan_item_leaders (plan_item_id, sort_order);
create index if not exists plan_item_leaders_plan_idx
  on public.plan_item_leaders (plan_id);
create index if not exists plan_item_leaders_person_idx
  on public.plan_item_leaders (person_id)
  where person_id is not null;

create table if not exists public.plan_notes (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  plan_id uuid not null,
  -- Null for a plan-level note.
  plan_item_id uuid,
  category text not null
    constraint plan_notes_category_check check (category in ('general', 'tech', 'worship', 'slides')),
  body text not null
    constraint plan_notes_body_length check (length(body) between 1 and 8000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,
  constraint plan_notes_one_per_category unique nulls not distinct (plan_id, plan_item_id, category),
  foreign key (plan_id, church_id)
    references public.plans (id, church_id) on delete cascade,
  foreign key (plan_item_id, plan_id, church_id)
    references public.plan_items (id, plan_id, church_id) on delete cascade
);

create index if not exists plan_notes_item_idx
  on public.plan_notes (plan_item_id)
  where plan_item_id is not null;

create table if not exists public.plan_team_members (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  plan_id uuid not null,
  team_position_id uuid not null,
  person_id uuid not null references public.members (id) on delete cascade,
  status text not null default 'unconfirmed'
    constraint plan_team_members_status_check check (status in ('unconfirmed', 'confirmed', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plan_team_members_unique unique (plan_id, team_position_id, person_id),
  foreign key (plan_id, church_id)
    references public.plans (id, church_id) on delete cascade,
  foreign key (team_position_id, church_id)
    references public.team_positions (id, church_id) on delete cascade
);

create index if not exists plan_team_members_person_idx
  on public.plan_team_members (person_id);

-- ---------------------------------------------------------------------------
-- SHARES
-- ---------------------------------------------------------------------------
--
-- One row per recipient link. `send_id` groups the rows one Share click made.
-- The token is 32 random bytes; only its SHA-256 is stored.

create table if not exists public.plan_shares (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null,
  plan_id uuid not null,
  send_id uuid not null,
  audience text not null
    constraint plan_shares_audience_check check (audience in ('team', 'person', 'link')),
  team_id uuid,
  -- A personal link goes with the person: removing someone from People
  -- must never be blocked by, or leave behind, a link addressed to them.
  person_id uuid references public.members (id) on delete cascade,
  preset text not null
    constraint plan_shares_preset_check check (preset in ('full', 'team', 'person', 'order')),
  -- Note categories this link shows (Team view and Full plan).
  categories text[] not null default '{}'
    constraint plan_shares_categories_check
      check (categories <@ array['general', 'tech', 'worship', 'slides']::text[]),
  channels text[] not null default '{}'
    constraint plan_shares_channels_check
      check (channels <@ array['email', 'sms', 'in_app', 'link']::text[]),
  token_hash bytea not null
    constraint plan_shares_token_hash_length check (octet_length(token_hash) = 32),
  version_sent integer not null,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  first_viewed_at timestamptz,
  last_viewed_at timestamptz,
  -- Delivery outcome per channel, e.g. {"email": "sent", "sms": "no_phone"}.
  delivery jsonb not null default '{}'::jsonb,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint plan_shares_token_hash_key unique (token_hash),
  constraint plan_shares_person_needs_person check (audience <> 'person' or person_id is not null),
  constraint plan_shares_team_needs_team check (audience <> 'team' or team_id is not null),
  foreign key (plan_id, church_id)
    references public.plans (id, church_id) on delete cascade,
  foreign key (team_id, church_id)
    references public.teams (id, church_id) on delete set null (team_id)
);

create index if not exists plan_shares_plan_idx
  on public.plan_shares (plan_id, created_at desc);

-- ---------------------------------------------------------------------------
-- INTEGRITY TRIGGERS
-- ---------------------------------------------------------------------------

-- `members` predates composite keys, so same-church references to it are
-- checked here. Applies to every table that names a person.
create or replace function public.service_plans_check_person_church()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.person_id is not null and not exists (
    select 1 from public.members m
    where m.id = new.person_id and m.church_id = new.church_id
  ) then
    raise exception 'That person belongs to a different church' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger plan_item_leaders_person_church
  before insert or update of person_id, church_id on public.plan_item_leaders
  for each row execute function public.service_plans_check_person_church();
create trigger plan_team_members_person_church
  before insert or update of person_id, church_id on public.plan_team_members
  for each row execute function public.service_plans_check_person_church();
create trigger plan_shares_person_church
  before insert or update of person_id, church_id on public.plan_shares
  for each row execute function public.service_plans_check_person_church();

-- An item's arrangement must be one of its song's arrangements.
create or replace function public.service_plans_check_item_song()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- A song leaving the library clears the item's song (on delete set null);
  -- its arrangement goes with it rather than blocking the delete.
  if new.song_id is null then
    new.arrangement_id := null;
  end if;
  if new.arrangement_id is not null and (not exists (
    select 1 from public.song_arrangements a
    where a.id = new.arrangement_id and a.song_id = new.song_id
  )) then
    raise exception 'That arrangement is not one of this song''s arrangements' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger plan_items_song_check
  before insert or update of song_id, arrangement_id on public.plan_items
  for each row execute function public.service_plans_check_item_song();

-- Anything a share recipient could see moves the plan's share_version, which
-- drives "Updated since last share" and Re-send changes. Also keeps the plan's
-- updated_at honest for the list page.
create or replace function public.service_plans_bump_share_version()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_plan uuid := coalesce(new.plan_id, old.plan_id);
begin
  update public.plans
     set share_version = share_version + 1,
         updated_at = now()
   where id = v_plan;
  return null;
end;
$$;

create trigger plan_items_bump_share_version
  after insert or update or delete on public.plan_items
  for each row execute function public.service_plans_bump_share_version();
create trigger plan_item_leaders_bump_share_version
  after insert or update or delete on public.plan_item_leaders
  for each row execute function public.service_plans_bump_share_version();
create trigger plan_notes_bump_share_version
  after insert or update or delete on public.plan_notes
  for each row execute function public.service_plans_bump_share_version();
create trigger plan_times_bump_share_version
  after insert or update or delete on public.plan_times
  for each row execute function public.service_plans_bump_share_version();

-- Header fields on the plan itself bump it too (without recursing on the
-- columns the trigger above writes).
create or replace function public.service_plans_bump_own_share_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (new.title, new.series, new.plan_date)
     is distinct from (old.title, old.series, old.plan_date) then
    new.share_version := old.share_version + 1;
  end if;
  new.updated_at := now();
  return new;
end;
$$;

create trigger plans_bump_own_share_version
  before update of title, series, plan_date on public.plans
  for each row execute function public.service_plans_bump_own_share_version();

create trigger service_types_touch before update on public.service_types
  for each row execute function public.service_plans_touch();
create trigger teams_touch before update on public.teams
  for each row execute function public.service_plans_touch();
create trigger songs_touch before update on public.songs
  for each row execute function public.service_plans_touch();
create trigger song_arrangements_touch before update on public.song_arrangements
  for each row execute function public.service_plans_touch();
create trigger plan_times_touch before update on public.plan_times
  for each row execute function public.service_plans_touch();
create trigger plan_items_touch before update on public.plan_items
  for each row execute function public.service_plans_touch();
create trigger plan_notes_touch before update on public.plan_notes
  for each row execute function public.service_plans_touch();
create trigger plan_team_members_touch before update on public.plan_team_members
  for each row execute function public.service_plans_touch();

-- ---------------------------------------------------------------------------
-- ATOMIC COMMANDS (service role only)
-- ---------------------------------------------------------------------------

-- Copies a plan's or template's live items, their leaders and their notes, plus
-- plan-level notes, into another plan of the same church. Used by New plan
-- (from a template or a previous plan) and Save as template. Team status and
-- times are not copied: the caller sets the new plan's times.
create or replace function public.service_plan_copy_contents(
  p_church_id uuid,
  p_source_plan_id uuid,
  p_target_plan_id uuid
)
returns integer
language plpgsql
set search_path = public
as $$
declare
  v_count integer;
begin
  if not exists (select 1 from public.plans where id = p_source_plan_id and church_id = p_church_id)
     or not exists (select 1 from public.plans where id = p_target_plan_id and church_id = p_church_id) then
    raise exception 'Both plans must belong to this church' using errcode = '23514';
  end if;

  create temporary table service_plan_item_map (old_id uuid primary key, new_id uuid not null)
    on commit drop;

  insert into service_plan_item_map (old_id, new_id)
  select i.id, gen_random_uuid()
    from public.plan_items i
   where i.plan_id = p_source_plan_id and i.deleted_at is null;

  insert into public.plan_items (
    id, church_id, plan_id, position, item_type, title, length_seconds,
    description, song_id, arrangement_id, song_key, media_url
  )
  select m.new_id, p_church_id, p_target_plan_id, i.position, i.item_type, i.title,
         i.length_seconds, i.description, i.song_id, i.arrangement_id, i.song_key, i.media_url
    from public.plan_items i
    join service_plan_item_map m on m.old_id = i.id;
  get diagnostics v_count = row_count;

  insert into public.plan_item_leaders (church_id, plan_id, plan_item_id, person_id, team_position_id, sort_order)
  select p_church_id, p_target_plan_id, m.new_id, l.person_id, l.team_position_id, l.sort_order
    from public.plan_item_leaders l
    join service_plan_item_map m on m.old_id = l.plan_item_id;

  insert into public.plan_notes (church_id, plan_id, plan_item_id, category, body)
  select p_church_id, p_target_plan_id, m.new_id, n.category, n.body
    from public.plan_notes n
    left join service_plan_item_map m on m.old_id = n.plan_item_id
   where n.plan_id = p_source_plan_id
     and (n.plan_item_id is null or m.new_id is not null);

  drop table service_plan_item_map;
  return v_count;
end;
$$;

-- Replaces an item's leaders in one statement batch, so the row chip and the
-- panel can never leave a half-written set.
create or replace function public.service_plan_set_item_leaders(
  p_church_id uuid,
  p_item_id uuid,
  p_leaders jsonb
)
returns void
language plpgsql
set search_path = public
as $$
declare
  v_plan uuid;
begin
  select plan_id into v_plan
    from public.plan_items
   where id = p_item_id and church_id = p_church_id and deleted_at is null
   for update;
  if v_plan is null then
    raise exception 'That item no longer exists' using errcode = 'P0002';
  end if;
  if jsonb_typeof(p_leaders) <> 'array' or jsonb_array_length(p_leaders) > 20 then
    raise exception 'Leaders must be a list of at most 20' using errcode = '22023';
  end if;

  delete from public.plan_item_leaders where plan_item_id = p_item_id;

  insert into public.plan_item_leaders (church_id, plan_id, plan_item_id, person_id, team_position_id, sort_order)
  select p_church_id, v_plan, p_item_id,
         nullif(e.value ->> 'personId', '')::uuid,
         nullif(e.value ->> 'teamPositionId', '')::uuid,
         (e.ordinality - 1)::integer
    from jsonb_array_elements(p_leaders) with ordinality as e(value, ordinality);
end;
$$;

do $$
declare
  v_fn text;
begin
  foreach v_fn in array array[
    'public.service_plans_touch()',
    'public.service_plans_check_person_church()',
    'public.service_plans_check_item_song()',
    'public.service_plans_bump_share_version()',
    'public.service_plans_bump_own_share_version()',
    'public.service_plan_copy_contents(uuid, uuid, uuid)',
    'public.service_plan_set_item_leaders(uuid, uuid, jsonb)'
  ] loop
    execute format('revoke all on function %s from public, anon, authenticated', v_fn);
    execute format('grant execute on function %s to service_role', v_fn);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
--
-- Start from nothing, then grant back reads to staff who hold the feature.
-- No browser write path anywhere.

alter table public.service_types enable row level security;
alter table public.service_type_times enable row level security;
alter table public.teams enable row level security;
alter table public.team_positions enable row level security;
alter table public.team_note_categories enable row level security;
alter table public.songs enable row level security;
alter table public.song_arrangements enable row level security;
alter table public.song_attachments enable row level security;
alter table public.plans enable row level security;
alter table public.plan_times enable row level security;
alter table public.plan_items enable row level security;
alter table public.plan_item_leaders enable row level security;
alter table public.plan_notes enable row level security;
alter table public.plan_team_members enable row level security;
alter table public.plan_shares enable row level security;

revoke all on table public.service_types from public, anon, authenticated;
revoke all on table public.service_type_times from public, anon, authenticated;
revoke all on table public.teams from public, anon, authenticated;
revoke all on table public.team_positions from public, anon, authenticated;
revoke all on table public.team_note_categories from public, anon, authenticated;
revoke all on table public.songs from public, anon, authenticated;
revoke all on table public.song_arrangements from public, anon, authenticated;
revoke all on table public.song_attachments from public, anon, authenticated;
revoke all on table public.plans from public, anon, authenticated;
revoke all on table public.plan_times from public, anon, authenticated;
revoke all on table public.plan_items from public, anon, authenticated;
revoke all on table public.plan_item_leaders from public, anon, authenticated;
revoke all on table public.plan_notes from public, anon, authenticated;
revoke all on table public.plan_team_members from public, anon, authenticated;
revoke all on table public.plan_shares from public, anon, authenticated;

grant select on table
  public.service_types,
  public.service_type_times,
  public.teams,
  public.team_positions,
  public.team_note_categories,
  public.songs,
  public.song_arrangements,
  public.song_attachments,
  public.plans,
  public.plan_times,
  public.plan_items,
  public.plan_item_leaders,
  public.plan_notes,
  public.plan_team_members
  to authenticated;

-- Staff see who a plan was shared with and who has looked, never the hash.
grant select (
  id, church_id, plan_id, send_id, audience, team_id, person_id, preset,
  categories, channels, version_sent, expires_at, revoked_at,
  first_viewed_at, last_viewed_at, delivery, created_by, created_at
) on table public.plan_shares to authenticated;

grant select, insert, update, delete on table
  public.service_types,
  public.service_type_times,
  public.teams,
  public.team_positions,
  public.team_note_categories,
  public.songs,
  public.song_arrangements,
  public.song_attachments,
  public.plans,
  public.plan_times,
  public.plan_items,
  public.plan_item_leaders,
  public.plan_notes,
  public.plan_team_members,
  public.plan_shares
  to service_role;

create policy service_types_select on public.service_types
  for select to authenticated using (public.has_service_plans_access(church_id));
create policy service_type_times_select on public.service_type_times
  for select to authenticated using (public.has_service_plans_access(church_id));
create policy teams_select on public.teams
  for select to authenticated using (public.has_service_plans_access(church_id));
create policy team_positions_select on public.team_positions
  for select to authenticated using (public.has_service_plans_access(church_id));
create policy team_note_categories_select on public.team_note_categories
  for select to authenticated using (public.has_service_plans_access(church_id));
create policy songs_select on public.songs
  for select to authenticated using (public.has_service_plans_access(church_id));
create policy song_arrangements_select on public.song_arrangements
  for select to authenticated using (public.has_service_plans_access(church_id));
create policy song_attachments_select on public.song_attachments
  for select to authenticated using (public.has_service_plans_access(church_id));
create policy plans_select on public.plans
  for select to authenticated using (public.has_service_plans_access(church_id));
create policy plan_times_select on public.plan_times
  for select to authenticated using (public.has_service_plans_access(church_id));
create policy plan_items_select on public.plan_items
  for select to authenticated using (public.has_service_plans_access(church_id));
create policy plan_item_leaders_select on public.plan_item_leaders
  for select to authenticated using (public.has_service_plans_access(church_id));
create policy plan_notes_select on public.plan_notes
  for select to authenticated using (public.has_service_plans_access(church_id));
create policy plan_team_members_select on public.plan_team_members
  for select to authenticated using (public.has_service_plans_access(church_id));
create policy plan_shares_select on public.plan_shares
  for select to authenticated using (public.has_service_plans_access(church_id));

-- ---------------------------------------------------------------------------
-- REALTIME
-- ---------------------------------------------------------------------------
--
-- Two planners see each other's edits without a refresh. Realtime applies the
-- select policies above, so a subscriber only hears about their own church.

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table
      public.plans,
      public.plan_items,
      public.plan_item_leaders,
      public.plan_notes,
      public.plan_times;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- STORAGE
-- ---------------------------------------------------------------------------
--
-- Chord chart PDFs and other song files. Private, no policies: uploads use
-- server-issued signed upload URLs and reads use short-lived signed URLs.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'song-files',
  'song-files',
  false,
  20971520, -- 20 MB
  array['application/pdf', 'image/png', 'image/jpeg', 'text/plain', 'audio/mpeg', 'audio/mp4']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
