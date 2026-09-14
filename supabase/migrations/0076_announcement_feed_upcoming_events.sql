-- Show churchgoers what is coming up, not only what is happening right now.
--
-- ## The bug
--
-- 0054 treated an announcement's `start_at` as a publish time: "scheduled but
-- not live is not yet visible". But `start_at` is the *event's* start — the
-- dashboard's announcement form writes the service, supper or youth night time
-- into it. So an announcement for next Sunday was invisible in the app until
-- next Sunday began, and gone again when it ended. The feed only ever showed
-- events already in progress, and an announcement with no end time stayed up
-- forever after it happened.
--
-- An end-to-end walk of the member journey against a local stack found it: a
-- church with three published, public, upcoming announcements returned an empty
-- feed.
--
-- ## The rule now
--
--   * **Visible once published.** `status = 'published'` as before, and — if a
--     publish time is in the future — not before it.
--   * **Until the event is over.** `end_at` when it is set. Without one, a timed
--     event drops out a day after it starts and an all-day event two days after
--     its date, which covers the whole local day in every timezone a church in
--     the Americas is in (`start_at` of an all-day event is midnight UTC).
--   * **Soonest first.** Pinned first, then by start ascending, so what is
--     happening now or next sits at the top and next month's retreat further
--     down. The cursor follows the same order.
--
-- Targeting, the explicit column list and the service-role-only grants are
-- unchanged from 0054.

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
  with visible as (
    select
      a.*,
      coalesce(a.start_at, a.event_date) as effective_start,
      coalesce(a.is_pinned and (a.pinned_until is null or a.pinned_until > p_now), false)
        as effective_pinned
    from public.announcements a
    join public.churches c on c.id = a.church_id
    where c.slug = p_church_slug
      -- Draft, pending, and unpublished rows are excluded structurally.
      and a.status = 'published'
      and a.is_ready
      and a.mobile_unpublished_at is null
      and a.mobile_visibility <> 'none'
      -- A publication dated in the future is not live yet.
      and coalesce(a.mobile_published_at, a.published_at, p_now) <= p_now
      -- Targeting. A caller with no usable relationship sees only 'public'.
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
    -- Over once it has ended.
    and coalesce(
      v.end_at,
      v.effective_start
        + case when coalesce(v.all_day, false) then interval '2 days' else interval '1 day' end
    ) > p_now
    -- Pinned first, then soonest; the cursor is the last row already sent.
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

-- One announcement, re-authorized on read, by the same rules as the feed.

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
