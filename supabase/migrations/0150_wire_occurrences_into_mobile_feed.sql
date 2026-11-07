-- Wire announcement_occurrences into mobile feed and calendar
-- Migration 0150
--
-- Updates mobile_announcement_feed and mobile_announcement_schedule to:
-- 1. Show individual occurrences of recurring events
-- 2. Hide cancelled occurrences
-- 3. Apply occurrence-specific overrides (title, location, time)
-- 4. Maintain backward compatibility with non-recurring events

-- Update mobile_announcement_feed to show recurring occurrences
drop function if exists public.mobile_announcement_feed(text, text, boolean, timestamptz, uuid, integer, timestamptz);

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
  all_day boolean,
  location text,
  poster_url text,
  poster_alt_text text,
  is_pinned boolean,
  visibility text,
  publication_version integer,
  published_at timestamptz,
  cursor_pinned boolean,
  cursor_start timestamptz,
  cursor_id uuid,
  occurrence_id uuid,
  parent_announcement_id uuid
)
language sql
security definer
stable
set search_path = public
as $$
  with visible_announcements as (
    select
      a.*,
      coalesce(a.start_at, a.event_date) as effective_start,
      coalesce(a.is_pinned and (a.pinned_until is null or a.pinned_until > p_now), false) as effective_pinned
    from public.announcements a
    join public.churches c on c.id = a.church_id
    where c.slug = p_church_slug
      and a.status = 'published'
      and a.is_ready
      and a.mobile_unpublished_at is null
      and a.mobile_visibility <> 'none'
      and coalesce(a.mobile_published_at, a.published_at, p_now) <= p_now
      and (
        a.mobile_visibility = 'public'
        or (a.mobile_visibility = 'followers' and p_relationship_state in ('following', 'joined'))
        or (a.mobile_visibility = 'members' and p_relationship_state = 'joined')
      )
  ),
  expanded_events as (
    -- Non-recurring events
    select
      v.id,
      coalesce(v.title, v.event_title) as title,
      coalesce(nullif(v.body, ''), v.notes, '') as body,
      v.effective_start as start_at,
      v.end_at,
      coalesce(v.all_day, false) as all_day,
      v.event_location as location,
      v.social_graphic_url as poster_url,
      v.poster_alt_text,
      v.effective_pinned as is_pinned,
      v.mobile_visibility as visibility,
      v.publication_version,
      coalesce(v.published_at, v.mobile_published_at) as published_at,
      null::uuid as occurrence_id,
      null::uuid as parent_announcement_id
    from visible_announcements v
    where (not v.is_recurring or not exists (
      select 1 from public.announcement_occurrences o
      where o.announcement_id = v.id and o.church_id = v.church_id
    ))
      and v.effective_start is not null
      and coalesce(
        v.end_at,
        v.effective_start + case when coalesce(v.all_day, false) then interval '2 days' else interval '1 day' end
      ) > p_now

    union all

    -- Recurring event occurrences
    select
      o.id as id,
      coalesce(o.title, v.title, v.event_title) as title,
      coalesce(o.description, nullif(v.body, ''), v.notes, '') as body,
      o.start_at,
      o.end_at,
      o.all_day,
      coalesce(o.event_location, v.event_location) as location,
      v.social_graphic_url as poster_url,
      v.poster_alt_text,
      v.effective_pinned as is_pinned,
      v.mobile_visibility as visibility,
      v.publication_version,
      coalesce(v.published_at, v.mobile_published_at) as published_at,
      o.id as occurrence_id,
      v.id as parent_announcement_id
    from visible_announcements v
    join public.announcement_occurrences o on o.announcement_id = v.id and o.church_id = v.church_id
    where v.is_recurring
      and o.status = 'active'
      and coalesce(
        o.end_at,
        o.start_at + case when o.all_day then interval '2 days' else interval '1 day' end
      ) > p_now
  )
  select
    e.id::uuid,
    e.title,
    e.body,
    e.start_at,
    e.end_at,
    e.all_day,
    e.location,
    e.poster_url,
    e.poster_alt_text,
    e.is_pinned,
    e.visibility,
    e.publication_version,
    e.published_at,
    e.is_pinned as cursor_pinned,
    e.start_at as cursor_start,
    e.id::uuid as cursor_id,
    e.occurrence_id,
    e.parent_announcement_id
  from expanded_events e
  where (
    p_cursor_id is null
    or (coalesce(p_cursor_pinned, false) and not e.is_pinned)
    or (
      e.is_pinned = coalesce(p_cursor_pinned, false)
      and (e.start_at, e.id::uuid) > (p_cursor_start, p_cursor_id)
    )
  )
  order by
    e.is_pinned desc,
    e.start_at asc,
    e.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

revoke all on function public.mobile_announcement_feed(text, text, boolean, timestamptz, uuid, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.mobile_announcement_feed(text, text, boolean, timestamptz, uuid, integer, timestamptz) to service_role;

-- Update mobile_announcement_schedule to show recurring occurrences
drop function if exists public.mobile_announcement_schedule(text, text, timestamptz, timestamptz, timestamptz);

create or replace function public.mobile_announcement_schedule(
  p_church_slug text,
  p_relationship_state text,
  p_from timestamptz,
  p_to timestamptz,
  p_now timestamptz default now()
)
returns table (
  id uuid,
  title text,
  body text,
  start_at timestamptz,
  end_at timestamptz,
  all_day boolean,
  location text,
  poster_url text,
  poster_alt_text text,
  is_pinned boolean,
  visibility text,
  publication_version integer,
  published_at timestamptz,
  occurrence_id uuid,
  parent_announcement_id uuid
)
language sql
security definer
stable
set search_path = public
as $$
  with visible_announcements as (
    select
      a.*,
      coalesce(a.start_at, a.event_date) as effective_start,
      coalesce(
        a.end_at,
        coalesce(a.start_at, a.event_date) + case when coalesce(a.all_day, false) then interval '2 days' else interval '1 day' end
      ) as effective_end,
      coalesce(a.is_pinned and (a.pinned_until is null or a.pinned_until > p_now), false) as effective_pinned
    from public.announcements a
    join public.churches c on c.id = a.church_id
    where c.slug = p_church_slug
      and a.status = 'published'
      and a.is_ready
      and a.mobile_unpublished_at is null
      and a.mobile_visibility <> 'none'
      and coalesce(a.mobile_published_at, a.published_at, p_now) <= p_now
      and (
        a.mobile_visibility = 'public'
        or (a.mobile_visibility = 'followers' and p_relationship_state in ('following', 'joined'))
        or (a.mobile_visibility = 'members' and p_relationship_state = 'joined')
      )
  ),
  expanded_events as (
    -- Non-recurring events
    select
      v.id,
      coalesce(v.title, v.event_title) as title,
      coalesce(nullif(v.body, ''), v.notes, '') as body,
      v.effective_start as start_at,
      v.end_at,
      coalesce(v.all_day, false) as all_day,
      v.event_location as location,
      v.social_graphic_url as poster_url,
      v.poster_alt_text,
      v.effective_pinned as is_pinned,
      v.mobile_visibility as visibility,
      v.publication_version,
      coalesce(v.published_at, v.mobile_published_at) as published_at,
      null::uuid as occurrence_id,
      null::uuid as parent_announcement_id,
      v.effective_start,
      v.effective_end
    from visible_announcements v
    where (not v.is_recurring or not exists (
      select 1 from public.announcement_occurrences o
      where o.announcement_id = v.id and o.church_id = v.church_id
    ))
      and v.effective_start is not null

    union all

    -- Recurring event occurrences
    select
      o.id as id,
      coalesce(o.title, v.title, v.event_title) as title,
      coalesce(o.description, nullif(v.body, ''), v.notes, '') as body,
      o.start_at,
      o.end_at,
      o.all_day,
      coalesce(o.event_location, v.event_location) as location,
      v.social_graphic_url as poster_url,
      v.poster_alt_text,
      v.effective_pinned as is_pinned,
      v.mobile_visibility as visibility,
      v.publication_version,
      coalesce(v.published_at, v.mobile_published_at) as published_at,
      o.id as occurrence_id,
      v.id as parent_announcement_id,
      o.start_at as effective_start,
      coalesce(
        o.end_at,
        o.start_at + case when o.all_day then interval '2 days' else interval '1 day' end
      ) as effective_end
    from visible_announcements v
    join public.announcement_occurrences o on o.announcement_id = v.id and o.church_id = v.church_id
    where v.is_recurring
      and o.status = 'active'
  )
  select
    e.id::uuid,
    e.title,
    e.body,
    e.start_at,
    e.end_at,
    e.all_day,
    e.location,
    e.poster_url,
    e.poster_alt_text,
    e.is_pinned,
    e.visibility,
    e.publication_version,
    e.published_at,
    e.occurrence_id,
    e.parent_announcement_id
  from expanded_events e
  where e.effective_start < p_to
    and e.effective_end > p_from
  order by e.effective_start asc, e.id asc
$$;

revoke all on function public.mobile_announcement_schedule(text, text, timestamptz, timestamptz, timestamptz) from public, anon, authenticated;
grant execute on function public.mobile_announcement_schedule(text, text, timestamptz, timestamptz, timestamptz) to service_role;

-- Update mobile_announcement_detail to show specific occurrence when requested
drop function if exists public.mobile_announcement_detail(text, uuid, text, timestamptz);

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
  all_day boolean,
  location text,
  poster_url text,
  poster_alt_text text,
  is_pinned boolean,
  visibility text,
  publication_version integer,
  published_at timestamptz,
  is_recurring boolean,
  recurrence_rule text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    coalesce(o.id, a.id),
    coalesce(o.title, a.title, a.event_title),
    coalesce(o.description, nullif(a.body, ''), a.notes, ''),
    coalesce(o.start_at, a.start_at, a.event_date),
    case when o.id is not null then o.end_at else a.end_at end,
    coalesce(o.all_day, a.all_day, false),
    coalesce(o.event_location, a.event_location),
    a.social_graphic_url,
    a.poster_alt_text,
    (a.is_pinned and (a.pinned_until is null or a.pinned_until > p_now)),
    a.mobile_visibility,
    a.publication_version,
    coalesce(a.published_at, a.mobile_published_at),
    a.is_recurring,
    a.recurrence_rule
  from public.announcements a
  join public.churches c on c.id = a.church_id
  left join public.announcement_occurrences o
    on o.announcement_id = a.id and o.church_id = a.church_id
    and o.id = p_announcement_id and o.status = 'active' and a.is_recurring
  where c.slug = p_church_slug
    and (a.id = p_announcement_id or o.id = p_announcement_id)
    and a.status = 'published'
    and a.is_ready
    and a.mobile_unpublished_at is null
    and a.mobile_visibility <> 'none'
    and coalesce(o.start_at, a.start_at, a.event_date) is not null
    and (o.id is not null or coalesce(a.end_at, coalesce(a.start_at, a.event_date)
      + case when a.all_day then interval '2 days' else interval '1 day' end) > p_now)
    and coalesce(a.mobile_published_at, a.published_at, p_now) <= p_now
    and (
      a.mobile_visibility = 'public'
      or (a.mobile_visibility = 'followers' and p_relationship_state in ('following', 'joined'))
      or (a.mobile_visibility = 'members' and p_relationship_state = 'joined')
    )
$$;

revoke all on function public.mobile_announcement_detail(text, uuid, text, timestamptz) from public, anon, authenticated;
grant execute on function public.mobile_announcement_detail(text, uuid, text, timestamptz) to service_role;

notify pgrst, 'reload schema';
