-- One church per app account, and the church's own links in the app
-- Migration 0090
--
-- The member app no longer asks people to choose between following a church
-- and joining it, and no longer lets one account collect several churches.
-- A person adds their church; adding another replaces it. The application
-- enforces that on every write (`lib/faithform/relationships.ts`), and this
-- migration brings existing accounts into line so the rule holds for everyone,
-- not only for people who add a church after it shipped.
--
-- Nothing is deleted. A released relationship becomes `left` — the same state
-- a person reaches by removing a church themselves — and the audit log records
-- why, so any individual case can be traced and restored.

-- ---------------------------------------------------------------------------
-- 1. Quick links shown on the church's page in the app
-- ---------------------------------------------------------------------------
--
-- Social profiles already have their own columns (instagram_url and friends).
-- These are the church's own destinations — "Plan a visit", "Prayer
-- requests", "Small groups" — as an ordered list of { label, url }.

alter table public.churches
  add column if not exists app_links jsonb not null default '[]'::jsonb;

alter table public.churches
  drop constraint if exists churches_app_links_is_array;

alter table public.churches
  add constraint churches_app_links_is_array
  check (jsonb_typeof(app_links) = 'array' and jsonb_array_length(app_links) <= 12);

-- ---------------------------------------------------------------------------
-- 2. Public projections for the church page
-- ---------------------------------------------------------------------------
--
-- Same rules as `public_church_profile` (0053): listed churches only, and
-- every column named, so a private column added to `churches` later cannot
-- leak through here. A church's people read their own unlisted church through
-- the relationship-checked server path instead.

create or replace function public.public_church_app_page(p_slug text)
returns table (
  description text,
  google_maps_url text,
  instagram_url text,
  facebook_url text,
  youtube_url text,
  tiktok_url text,
  x_url text,
  podcast_url text,
  app_links jsonb
)
language sql
security definer
stable
set search_path = public
as $$
  select
    c.description, c.google_maps_url,
    c.instagram_url, c.facebook_url, c.youtube_url, c.tiktok_url, c.x_url,
    c.podcast_url, c.app_links
  from public.churches c
  where c.is_discoverable
    and c.slug is not null
    and c.slug = p_slug
$$;

-- Service times recorded for the church as a whole. The dashboard saves them
-- without a campus, and `public_church_campuses` only returns campus-linked
-- times, so until now these never reached the app at all.
create or replace function public.public_church_services(p_slug text)
returns table (
  label text,
  day_of_week smallint,
  start_time time,
  kind text
)
language sql
security definer
stable
set search_path = public
as $$
  select st.label, st.day_of_week, st.start_time, st.kind
  from public.churches c
  join public.church_service_times st on st.church_id = c.id
  where c.is_discoverable
    and c.slug = p_slug
    and st.campus_id is null
  order by st.sort_order, st.id
$$;

grant execute on function public.public_church_app_page(text) to anon, authenticated;
grant execute on function public.public_church_services(text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Keep one church per account
-- ---------------------------------------------------------------------------
--
-- Which one stays: the church the person last selected, if it is still
-- active; otherwise a real membership over a follow; otherwise the most
-- recently changed. The others are released exactly as the state machine's
-- `revoke` (system) transition would release them.

with active as (
  select
    r.id,
    r.account_id,
    r.church_id,
    r.state,
    r.updated_at,
    a.selected_church_id
  from public.visitor_church_relationships r
  join public.visitor_accounts a on a.id = r.account_id
  where r.state in ('following', 'pending', 'joined')
),
ranked as (
  select
    active.*,
    row_number() over (
      partition by account_id
      order by
        (church_id = selected_church_id) desc nulls last,
        (state = 'joined') desc,
        updated_at desc,
        id
    ) as position
  from active
),
released as (
  update public.visitor_church_relationships r
     set state = 'left',
         left_at = now(),
         updated_at = now()
    from ranked
   where ranked.id = r.id
     and ranked.position > 1
  returning r.id, r.account_id, r.church_id, ranked.state as from_state
),
logged as (
  insert into public.visitor_relationship_events (
    relationship_id, account_id, church_id,
    from_state, to_state, action, actor_type, reason
  )
  select id, account_id, church_id, from_state, 'left', 'revoke', 'system',
         'one church per account'
    from released
  returning account_id
)
-- Losing access must invalidate what a device cached under the old answer,
-- and the kept church becomes the selection so the app opens on it.
update public.visitor_accounts a
   set authorization_version = a.authorization_version + 1,
       selected_church_id = (
         select k.church_id from ranked k
          where k.account_id = a.id and k.position = 1
       ),
       updated_at = now()
 where a.id in (select distinct account_id from logged);
