-- Month calendar for the Home Schedule pane.
--
-- The feed lists what is still upcoming, soonest first, with a cursor. The
-- schedule needs every published event whose window overlaps a visible month,
-- including ones that already happened earlier in that month. Targeting and
-- publication gates match `mobile_announcement_feed`. `all_day` is returned so
-- clients can render date-only events without shifting midnight UTC.

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
  published_at timestamptz
)
language sql
security definer
stable
set search_path = public
as $$
  with visible as (
    select
      a.*,
      coalesce(a.start_at, a.event_date) as effective_start,
      coalesce(
        a.end_at,
        coalesce(a.start_at, a.event_date)
          + case when coalesce(a.all_day, false) then interval '2 days' else interval '1 day' end
      ) as effective_end,
      coalesce(a.is_pinned and (a.pinned_until is null or a.pinned_until > p_now), false)
        as effective_pinned
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
        or (a.mobile_visibility = 'followers'
            and p_relationship_state in ('following', 'joined'))
        or (a.mobile_visibility = 'members'
            and p_relationship_state = 'joined')
      )
  )
  select
    v.id,
    coalesce(v.title, v.event_title) as title,
    coalesce(nullif(v.body, ''), v.notes, '') as body,
    v.effective_start as start_at,
    v.end_at,
    coalesce(v.all_day, false) as all_day,
    v.event_location,
    v.social_graphic_url,
    v.poster_alt_text,
    v.effective_pinned as is_pinned,
    v.mobile_visibility,
    v.publication_version,
    coalesce(v.published_at, v.mobile_published_at) as published_at
  from visible v
  where v.effective_start is not null
    and v.effective_start < p_to
    and v.effective_end > p_from
  order by v.effective_start asc, v.id asc
$$;

-- Feed and detail now expose `all_day` for date-only rendering.
-- Postgres rejects CREATE OR REPLACE when OUT columns change, so drop first.

drop function if exists
  public.mobile_announcement_feed(text, text, boolean, timestamptz, uuid, integer, timestamptz);

drop function if exists
  public.mobile_announcement_detail(text, uuid, text, timestamptz);

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
  cursor_id uuid
)
language sql
security definer
stable
set search_path = public
as $$
  with visible as (
    select
      a.*,
      coalesce(a.start_at, a.event_date) as effective_start,
      coalesce(a.is_pinned and (a.pinned_until is null or a.pinned_until > p_now), false)
        as effective_pinned
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
        or (a.mobile_visibility = 'followers'
            and p_relationship_state in ('following', 'joined'))
        or (a.mobile_visibility = 'members'
            and p_relationship_state = 'joined')
      )
  )
  select
    v.id,
    coalesce(v.title, v.event_title) as title,
    coalesce(nullif(v.body, ''), v.notes, '') as body,
    v.effective_start as start_at,
    v.end_at,
    coalesce(v.all_day, false) as all_day,
    v.event_location,
    v.social_graphic_url,
    v.poster_alt_text,
    v.effective_pinned as is_pinned,
    v.mobile_visibility,
    v.publication_version,
    coalesce(v.published_at, v.mobile_published_at) as published_at,
    v.effective_pinned as cursor_pinned,
    v.effective_start as cursor_start,
    v.id as cursor_id
  from visible v
  where v.effective_start is not null
    and coalesce(
      v.end_at,
      v.effective_start
        + case when coalesce(v.all_day, false) then interval '2 days' else interval '1 day' end
    ) > p_now
    and (
      p_cursor_id is null
      or (coalesce(p_cursor_pinned, false) and not v.effective_pinned)
      or (
        v.effective_pinned = coalesce(p_cursor_pinned, false)
        and (v.effective_start, v.id) > (p_cursor_start, p_cursor_id)
      )
    )
  order by
    v.effective_pinned desc,
    v.effective_start asc,
    v.id asc
  limit least(greatest(coalesce(p_limit, 20), 1), 50)
$$;

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
    coalesce(a.all_day, false),
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
    and coalesce(a.mobile_published_at, a.published_at, p_now) <= p_now
    and coalesce(a.start_at, a.event_date) is not null
    and coalesce(
      a.end_at,
      coalesce(a.start_at, a.event_date)
        + case when coalesce(a.all_day, false) then interval '2 days' else interval '1 day' end
    ) > p_now
    and (
      a.mobile_visibility = 'public'
      or (a.mobile_visibility = 'followers'
          and p_relationship_state in ('following', 'joined'))
      or (a.mobile_visibility = 'members'
          and p_relationship_state = 'joined')
    )
$$;

revoke all on function
  public.mobile_announcement_schedule(text, text, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.mobile_announcement_schedule(text, text, timestamptz, timestamptz, timestamptz)
  to service_role;

revoke all on function
  public.mobile_announcement_feed(text, text, boolean, timestamptz, uuid, integer, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.mobile_announcement_feed(text, text, boolean, timestamptz, uuid, integer, timestamptz)
  to service_role;

revoke all on function
  public.mobile_announcement_detail(text, uuid, text, timestamptz)
  from public, anon, authenticated;
grant execute on function
  public.mobile_announcement_detail(text, uuid, text, timestamptz)
  to service_role;
