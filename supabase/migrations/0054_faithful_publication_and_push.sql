-- Faithful: mobile publication projection, device installations, and push outbox
-- Migration 0054 (Prompt 5)
--
-- Additive. Depends on 0050 (security baseline) and 0053 (visitor identity).
--
-- FaithForm remains the only place an announcement is authored or published.
-- Nothing here creates a second announcement, event, church, or membership
-- authority: the mobile projection is a set of columns *on the existing
-- announcements row*, and targeting reuses the visitor relationship states from
-- 0053 rather than inventing a second membership model.
--
-- Rollback: every object is new except the additive columns on
-- public.announcements, which default to a state that shows nothing in the app.
-- Dropping the tables in reverse dependency order and dropping those columns
-- restores the prior schema without touching any existing publication path.

-- ---------------------------------------------------------------------------
-- ANNOUNCEMENT MOBILE PUBLICATION PROJECTION
-- ---------------------------------------------------------------------------
--
-- `mobile_visibility` defaults to 'none': applying this migration publishes
-- nothing. An existing announcement becomes visible in Faithful only when
-- someone in FaithForm deliberately chooses an audience.

alter table public.announcements
  add column if not exists mobile_visibility text not null default 'none',
  add column if not exists is_pinned boolean not null default false,
  add column if not exists pinned_until timestamptz,
  add column if not exists poster_alt_text text,
  -- Bumped whenever anything a client caches changes. The mobile ETag is
  -- derived from it, so an edit invalidates a cached feed without a timestamp
  -- comparison that two servers could disagree about.
  add column if not exists publication_version integer not null default 1,
  add column if not exists mobile_published_at timestamptz,
  add column if not exists mobile_unpublished_at timestamptz;

do $$
begin
  alter table public.announcements
    add constraint announcements_mobile_visibility_check
    check (mobile_visibility in ('none', 'public', 'followers', 'members'));
exception
  when duplicate_object then null;
end $$;

-- The feed's exact filter and order. Partial, because the overwhelming
-- majority of rows are never mobile-visible and should not sit in this index.
create index if not exists announcements_mobile_feed_idx
  on public.announcements (church_id, is_pinned desc, start_at desc, id desc)
  where mobile_visibility <> 'none' and status = 'published';

create or replace function public.bump_announcement_publication_version()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- Only the fields a device actually renders or caches. Bumping on every
  -- column would invalidate feeds for provider bookkeeping nobody can see.
  if new.title is distinct from old.title
     or new.body is distinct from old.body
     or new.start_at is distinct from old.start_at
     or new.end_at is distinct from old.end_at
     or new.event_location is distinct from old.event_location
     or new.social_graphic_url is distinct from old.social_graphic_url
     or new.poster_alt_text is distinct from old.poster_alt_text
     or new.mobile_visibility is distinct from old.mobile_visibility
     or new.is_pinned is distinct from old.is_pinned
     or new.pinned_until is distinct from old.pinned_until
     or new.status is distinct from old.status
  then
    new.publication_version := coalesce(old.publication_version, 1) + 1;
  end if;
  return new;
end;
$$;

drop trigger if exists announcements_bump_publication_version on public.announcements;
create trigger announcements_bump_publication_version
  before update on public.announcements
  for each row execute function public.bump_announcement_publication_version();

-- ---------------------------------------------------------------------------
-- NEARBY CHURCH DISCOVERY
-- ---------------------------------------------------------------------------
--
-- Deliberately plain Postgres: no PostGIS dependency is introduced, because
-- adding an extension is a database-owner decision this migration must not make
-- on someone's behalf.
--
-- The query is bounded by a latitude/longitude bounding box the index can
-- serve, and only the survivors of that box are measured with haversine. That
-- keeps it a bounded index scan rather than a full-table distance calculation,
-- and it never loads campuses into application memory.

create index if not exists church_campuses_geo_idx
  on public.church_campuses (latitude, longitude)
  where is_active and is_public and latitude is not null;

create or replace function public.discover_churches_nearby(
  p_latitude double precision,
  p_longitude double precision,
  p_radius_km double precision default 40,
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
  join_policy text,
  public_profile_version integer,
  campus_name text,
  distance_km double precision
)
language sql
security definer
stable
set search_path = public
as $$
  with bounds as (
    select
      -- Clamped so a hostile or mistaken client cannot ask for the planet.
      least(greatest(coalesce(p_radius_km, 40), 1), 200) as radius_km,
      least(greatest(coalesce(p_limit, 20), 1), 50) as row_limit
  ),
  box as (
    select
      radius_km,
      row_limit,
      -- One degree of latitude is ~111 km everywhere; longitude narrows with
      -- latitude, hence the cosine. cos() is floored so a near-polar query
      -- cannot divide by ~zero and produce an unbounded box.
      radius_km / 111.045 as lat_delta,
      radius_km / (111.045 * greatest(cos(radians(p_latitude)), 0.01)) as lon_delta
    from bounds
  )
  select
    c.slug,
    c.name,
    c.logo_url,
    c.public_summary,
    c.denomination,
    cc.city,
    cc.state,
    cc.postal_code,
    c.join_policy,
    c.public_profile_version,
    cc.name as campus_name,
    d.distance_km
  from box
  cross join lateral (
    select
      cc.*,
      -- Haversine, evaluated only for rows the bounding box already admitted.
      2 * 6371.0 * asin(
        sqrt(
          pow(sin(radians(cc.latitude - p_latitude) / 2), 2)
          + cos(radians(p_latitude)) * cos(radians(cc.latitude))
            * pow(sin(radians(cc.longitude - p_longitude) / 2), 2)
        )
      ) as distance_km
    from public.church_campuses cc
    where cc.is_active
      and cc.is_public
      and cc.latitude is not null
      and cc.longitude is not null
      and cc.latitude between p_latitude - box.lat_delta and p_latitude + box.lat_delta
      and cc.longitude between p_longitude - box.lon_delta and p_longitude + box.lon_delta
  ) d
  join public.church_campuses cc on cc.id = d.id
  join public.churches c on c.id = cc.church_id
  where c.is_discoverable
    and c.slug is not null
    and d.distance_km <= box.radius_km
  order by d.distance_km, c.name, c.slug
  limit (select row_limit from box)
$$;

grant execute on function
  public.discover_churches_nearby(double precision, double precision, double precision, integer)
  to anon, authenticated;

-- ---------------------------------------------------------------------------
-- MOBILE ANNOUNCEMENT FEED PROJECTION
-- ---------------------------------------------------------------------------
--
-- One place decides what a given relationship may see. Enumerating the columns
-- explicitly means a dashboard or provider field added to `announcements`
-- later cannot leak into the app by accident.
--
-- `p_relationship_state` is resolved server-side from the caller's own
-- relationship. It is never taken from a request.

create or replace function public.mobile_announcement_feed(
  p_church_slug text,
  p_relationship_state text,
  p_cursor_pinned boolean default null,
  p_cursor_start timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 20,
  p_now timestamptz default now()
)
returns table (
  id uuid,
  title text,
  body text,
  start_at timestamptz,
  end_at timestamptz,
  location text,
  poster_url text,
  poster_alt_text text,
  is_pinned boolean,
  visibility text,
  publication_version integer,
  published_at timestamptz,
  cursor_pinned boolean,
  cursor_start timestamptz,
  cursor_id uuid
)
language sql
security definer
stable
set search_path = public
as $$
  select
    a.id,
    coalesce(a.title, a.event_title) as title,
    coalesce(nullif(a.body, ''), a.notes, '') as body,
    coalesce(a.start_at, a.event_date) as start_at,
    a.end_at,
    a.event_location,
    a.social_graphic_url,
    a.poster_alt_text,
    -- A pin expires on its own rather than needing someone to remember.
    (a.is_pinned and (a.pinned_until is null or a.pinned_until > p_now)) as is_pinned,
    a.mobile_visibility,
    a.publication_version,
    coalesce(a.published_at, a.mobile_published_at) as published_at,
    (a.is_pinned and (a.pinned_until is null or a.pinned_until > p_now)) as cursor_pinned,
    coalesce(a.start_at, a.event_date) as cursor_start,
    a.id as cursor_id
  from public.announcements a
  join public.churches c on c.id = a.church_id
  where c.slug = p_church_slug
    -- Draft, pending, and unpublished rows are excluded structurally.
    and a.status = 'published'
    and a.is_ready
    and a.mobile_unpublished_at is null
    and a.mobile_visibility <> 'none'
    -- Scheduled-but-not-live is not yet visible.
    and coalesce(a.start_at, a.event_date) <= p_now
    -- Expired content drops out on its own.
    and (a.end_at is null or a.end_at > p_now)
    -- Targeting. A caller with no usable relationship sees only 'public'.
    and (
      a.mobile_visibility = 'public'
      or (a.mobile_visibility = 'followers'
          and p_relationship_state in ('following', 'joined'))
      or (a.mobile_visibility = 'members'
          and p_relationship_state = 'joined')
    )
    and (
      p_cursor_id is null
      or (
        coalesce(a.is_pinned and (a.pinned_until is null or a.pinned_until > p_now), false),
        coalesce(a.start_at, a.event_date),
        a.id
      ) < (coalesce(p_cursor_pinned, false), p_cursor_start, p_cursor_id)
    )
  order by
    (a.is_pinned and (a.pinned_until is null or a.pinned_until > p_now)) desc,
    coalesce(a.start_at, a.event_date) desc,
    a.id desc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

-- One announcement, re-authorized on read.
--
-- This is what a notification tap resolves against, so it is a single indexed
-- lookup rather than a page scan: the same visibility, targeting, expiry and
-- publication rules as the feed, applied to one row. If the item was edited,
-- withdrawn, retargeted, or the relationship was revoked since the push was
-- enqueued, this returns nothing and the app says so.

create or replace function public.mobile_announcement_detail(
  p_church_slug text,
  p_announcement_id uuid,
  p_relationship_state text,
  p_now timestamptz default now()
)
returns table (
  id uuid,
  title text,
  body text,
  start_at timestamptz,
  end_at timestamptz,
  location text,
  poster_url text,
  poster_alt_text text,
  is_pinned boolean,
  visibility text,
  publication_version integer,
  published_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  select
    a.id,
    coalesce(a.title, a.event_title),
    coalesce(nullif(a.body, ''), a.notes, ''),
    coalesce(a.start_at, a.event_date),
    a.end_at,
    a.event_location,
    a.social_graphic_url,
    a.poster_alt_text,
    (a.is_pinned and (a.pinned_until is null or a.pinned_until > p_now)),
    a.mobile_visibility,
    a.publication_version,
    coalesce(a.published_at, a.mobile_published_at)
  from public.announcements a
  join public.churches c on c.id = a.church_id
  where c.slug = p_church_slug
    and a.id = p_announcement_id
    and a.status = 'published'
    and a.is_ready
    and a.mobile_unpublished_at is null
    and a.mobile_visibility <> 'none'
    and coalesce(a.start_at, a.event_date) <= p_now
    and (a.end_at is null or a.end_at > p_now)
    and (
      a.mobile_visibility = 'public'
      or (a.mobile_visibility = 'followers'
          and p_relationship_state in ('following', 'joined'))
      or (a.mobile_visibility = 'members'
          and p_relationship_state = 'joined')
    )
$$;

revoke all on function
  public.mobile_announcement_detail(text, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.mobile_announcement_detail(text, uuid, text, timestamptz)
  to service_role;

revoke all on function
  public.mobile_announcement_feed(text, text, boolean, timestamptz, uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.mobile_announcement_feed(text, text, boolean, timestamptz, uuid, integer, timestamptz)
  to service_role;

-- ---------------------------------------------------------------------------
-- DEVICE INSTALLATIONS
-- ---------------------------------------------------------------------------
--
-- One row per app install per account. The provider token has to be stored in
-- usable form — APNs and FCM need the real value — so the table is service-role
-- only, has no client policy at all, and the token is never returned by any
-- projection or written to any log.
--
-- `install_id` is a client-generated stable identifier for the physical
-- install. It is what makes "the same phone signed in as someone else" a row
-- the server can find and retire, rather than an orphaned token that keeps
-- receiving the previous account's notifications.

create table if not exists public.visitor_device_installations (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.visitor_accounts (id) on delete cascade,

  install_id text not null,
  platform text not null check (platform in ('ios', 'android')),
  environment text not null,

  provider text not null check (provider in ('apns', 'fcm')),
  provider_token text not null,
  -- Rotation is a normal event, not an error: the OS reissues tokens.
  token_rotated_at timestamptz,

  app_version text,
  client_build integer,
  os_version text,
  locale text,

  -- Mirrors visitor_accounts.authorization_version at registration time, so a
  -- stale installation can be detected without re-deriving permissions.
  authorization_version integer not null default 1,

  is_enabled boolean not null default true,
  -- Set when a provider tells us the token is gone. Kept rather than deleted so
  -- a later re-registration of the same install is recognisable.
  invalidated_at timestamptz,
  invalidated_reason text,

  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One live row per install per environment. Re-registering updates rather
  -- than accumulating, so a phone cannot end up with a fan-out of stale tokens.
  unique (install_id, environment)
);

create index if not exists visitor_device_installations_account_idx
  on public.visitor_device_installations (account_id, is_enabled)
  where is_enabled;

-- The worker's exact filter when fanning out to a set of accounts.
create index if not exists visitor_device_installations_deliverable_idx
  on public.visitor_device_installations (account_id, provider)
  where is_enabled and invalidated_at is null;

-- ---------------------------------------------------------------------------
-- NOTIFICATION PREFERENCES
-- ---------------------------------------------------------------------------
--
-- Per account, per church, per topic. Absent means "not yet decided", which the
-- server treats as the topic default rather than as consent.

create table if not exists public.visitor_notification_preferences (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.visitor_accounts (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,

  topic text not null check (topic in ('announcements', 'events')),
  is_enabled boolean not null default true,

  -- Quiet hours are stored but not interpreted here. Prompt 5 does not decide
  -- what happens to a notification that arrives inside them — that is a product
  -- policy, and guessing it would be worse than leaving it explicit.
  quiet_hours_start time,
  quiet_hours_end time,
  quiet_hours_timezone text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (account_id, church_id, topic)
);

create index if not exists visitor_notification_preferences_lookup_idx
  on public.visitor_notification_preferences (church_id, topic, is_enabled);

-- ---------------------------------------------------------------------------
-- NOTIFICATION OUTBOX
-- ---------------------------------------------------------------------------
--
-- One logical notification per publication event, enqueued in the same
-- transaction that publishes. A push is an invalidation hint carrying a deep
-- link — never the content itself — so a notification that arrives after the
-- announcement was edited or withdrawn still opens whatever the person is
-- currently authorized to see, or nothing.

create table if not exists public.notification_outbox (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,

  kind text not null check (kind in ('announcement_published', 'event_published')),
  -- The row this notification is about. Resolved fresh at delivery time.
  subject_type text not null check (subject_type in ('announcement')),
  subject_id uuid not null,

  -- The audience as a rule, not as a materialized list. Re-resolved at send
  -- time so a relationship revoked between publish and send is honoured.
  target_visibility text not null
    check (target_visibility in ('public', 'followers', 'members')),
  topic text not null check (topic in ('announcements', 'events')),

  -- Short, and deliberately not the content. Long enough to be recognisable on
  -- a lock screen; the app fetches the real thing when opened.
  title text not null,
  body text,
  deep_link text not null,

  -- Two independent guarantees. `collapse_key` lets a provider replace an
  -- earlier unread notification about the same subject. `dedupe_key` is unique,
  -- so two workers or a retried publish cannot create a second logical
  -- notification for the same event.
  collapse_key text not null,
  dedupe_key text not null unique,

  status text not null default 'pending'
    check (status in ('pending', 'claimed', 'sent', 'cancelled', 'failed')),

  -- Publication version at enqueue time. If the subject has moved on by the
  -- time a worker runs, the job is cancelled rather than announcing stale text.
  subject_version integer not null default 1,

  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  lease_token text,
  lease_expires_at timestamptz,

  last_error_category text,
  correlation_id uuid not null default gen_random_uuid(),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz
);

-- The worker's exact claim predicate and order.
create index if not exists notification_outbox_claimable_idx
  on public.notification_outbox (next_attempt_at, id)
  where status in ('pending', 'claimed');

create index if not exists notification_outbox_subject_idx
  on public.notification_outbox (subject_type, subject_id, created_at desc);

-- One row per (notification, installation) attempt. Kept even on failure: a
-- failed delivery is exactly the one worth being able to look at.
create table if not exists public.notification_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  outbox_id uuid not null references public.notification_outbox (id) on delete cascade,
  installation_id uuid references public.visitor_device_installations (id) on delete set null,

  provider text not null check (provider in ('apns', 'fcm')),
  attempt_number integer not null default 1,

  outcome text not null
    check (outcome in ('sent', 'retryable', 'permanent', 'skipped')),
  -- A classification, never the provider's raw body: that can echo a token.
  error_category text,
  provider_status integer,

  created_at timestamptz not null default now(),

  -- One attempt row per installation per attempt number. A retried worker
  -- writing the same attempt twice collides instead of double-counting.
  unique (outbox_id, installation_id, attempt_number)
);

create index if not exists notification_delivery_attempts_outbox_idx
  on public.notification_delivery_attempts (outbox_id, created_at desc);

-- ---------------------------------------------------------------------------
-- ATOMIC WORKER CLAIM
-- ---------------------------------------------------------------------------
--
-- Leased rather than locked: a worker that dies mid-send has its lease expire
-- and the job becomes claimable again, instead of being stuck forever or
-- needing a separate reaper.

create or replace function public.claim_notification_jobs(
  p_lease_token text,
  p_limit integer default 10,
  p_lease_seconds integer default 120,
  p_now timestamptz default now()
)
returns setof public.notification_outbox
language plpgsql
volatile
security definer
set search_path = public
as $$
begin
  return query
  with claimable as (
    select o.id
    from public.notification_outbox o
    where o.status in ('pending', 'claimed')
      and o.next_attempt_at <= p_now
      and (o.lease_expires_at is null or o.lease_expires_at <= p_now)
      and o.attempts < o.max_attempts
    order by o.next_attempt_at, o.id
    limit least(greatest(coalesce(p_limit, 10), 1), 100)
    -- Two workers racing skip each other's rows rather than blocking.
    for update skip locked
  )
  update public.notification_outbox o
     set status = 'claimed',
         lease_token = p_lease_token,
         lease_expires_at = p_now + make_interval(secs => greatest(p_lease_seconds, 30)),
         attempts = o.attempts + 1,
         updated_at = p_now
    from claimable
   where o.id = claimable.id
  returning o.*;
end;
$$;

create or replace function public.complete_notification_job(
  p_id uuid,
  p_lease_token text,
  p_outcome text,
  p_error_category text default null,
  p_backoff_seconds integer default 60,
  p_now timestamptz default now()
)
returns boolean
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  updated integer;
begin
  update public.notification_outbox o
     set status = case
           when p_outcome = 'sent' then 'sent'
           when p_outcome = 'cancelled' then 'cancelled'
           when o.attempts >= o.max_attempts then 'failed'
           else 'pending'
         end,
         -- Exponential, capped: a provider outage must not become a hot loop.
         next_attempt_at = case
           when p_outcome in ('sent', 'cancelled') then o.next_attempt_at
           else p_now + make_interval(
             secs => least(greatest(p_backoff_seconds, 10) * power(2, o.attempts - 1), 3600)
           )
         end,
         last_error_category = p_error_category,
         lease_token = null,
         lease_expires_at = null,
         completed_at = case when p_outcome in ('sent', 'cancelled') then p_now else null end,
         updated_at = p_now
   where o.id = p_id
     -- Only the worker holding the lease may complete it.
     and o.lease_token = p_lease_token;

  get diagnostics updated = row_count;
  return updated > 0;
end;
$$;

revoke all on function
  public.claim_notification_jobs(text, integer, integer, timestamptz)
  from public, anon, authenticated;
revoke all on function
  public.complete_notification_job(uuid, text, text, text, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.claim_notification_jobs(text, integer, integer, timestamptz) to service_role;
grant execute on function
  public.complete_notification_job(uuid, text, text, text, integer, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- RLS AND GRANTS
-- ---------------------------------------------------------------------------

alter table public.visitor_device_installations enable row level security;
alter table public.visitor_notification_preferences enable row level security;
alter table public.notification_outbox enable row level security;
alter table public.notification_delivery_attempts enable row level security;

revoke all on table public.visitor_device_installations from anon, authenticated;
revoke all on table public.visitor_notification_preferences from anon, authenticated;
revoke all on table public.notification_outbox from anon, authenticated;
revoke all on table public.notification_delivery_attempts from anon, authenticated;

grant select on table public.visitor_notification_preferences to authenticated;

grant select, insert, update, delete
  on table public.visitor_device_installations,
     public.visitor_notification_preferences,
     public.notification_outbox,
     public.notification_delivery_attempts
  to service_role;

-- Installations hold provider tokens. No browser policy exists for this table
-- at all, deliberately — not even for the owning account.

-- The owner may read their own preferences. Writes go through a server command
-- that resolves the church relationship first.
create policy visitor_notification_preferences_select
  on public.visitor_notification_preferences
  for select to authenticated
  using (account_id = public.current_visitor_account_id());

-- Outbox and attempts are operational records for the send path. Staff read
-- delivery health through a projection, never the rows themselves, so no
-- authenticated policy is defined here.

notify pgrst, 'reload schema';
