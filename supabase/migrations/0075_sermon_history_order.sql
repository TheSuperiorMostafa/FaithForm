-- Sermon notes in the app, in the order they were preached.
--
-- 0068 ordered a church's sermon notes by the moment a pastor pressed Share.
-- That is click order, not history: sharing last month's sermon today put it
-- above this Sunday's, and pressing Update moved a sermon to the top. History
-- is ordered by the day it was preached — the date recorded when sharing, else
-- the sermon's own date from the builder, else the day it was first shared —
-- and only then by when it was shared.
--
-- Also fixed here:
--   * The page cap. The service asks for one row more than a page to learn
--     whether another page exists; with a cap of 50, `limit=50` could never
--     return a next page. The cap is the largest page (50) plus that one row.
--   * `preached_on` falls back to the builder's sermon date, so the date an app
--     shows is the date the list is sorted by.
--   * A series title is only joined from the sermon's own church.
--
-- The cursor gains the sort date, so the signature changes and the old
-- function is dropped rather than left as a second, differently-ordered path.
-- Apply this before deploying the code that calls it.

drop function if exists public.mobile_sermon_archive(
  text, text, text, timestamptz, uuid, integer
);

-- One page of a church's shared sermon notes, most recently preached first.
--
-- Search runs *after* the publication and relationship filters, so an
-- unpublished sermon's title cannot be discovered through the search box.
create or replace function public.mobile_sermon_archive(
  p_church_slug text,
  p_relationship_state text,
  p_query text default null,
  p_cursor_preached date default null,
  p_cursor_published timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 20
)
returns table (
  id uuid,
  title text,
  summary text,
  published_at timestamptz,
  preached_on date,
  scripture_refs text[],
  series_name text,
  publication_version integer,
  church_name text,
  church_timezone text,
  cursor_preached date,
  cursor_published timestamptz,
  cursor_id uuid
)
language sql
security definer
stable
set search_path = public
as $$
  select
    history.id,
    history.title,
    history.summary,
    history.published_at,
    history.preached_on,
    history.scripture_refs,
    history.series_name,
    history.publication_version,
    history.church_name,
    history.church_timezone,
    history.sort_date,
    history.published_at,
    history.id
  from (
    select
      s.id,
      coalesce(nullif(s.title, ''), 'Sermon') as title,
      s.mobile_summary as summary,
      s.mobile_published_at as published_at,
      coalesce(s.mobile_preached_on, s.sermon_date) as preached_on,
      s.scripture_refs,
      ss.title as series_name,
      s.mobile_publication_version as publication_version,
      c.name as church_name,
      c.timezone as church_timezone,
      -- UTC rather than the church's zone: `churches.timezone` is not
      -- validated, and one bad value must not take the whole archive down.
      -- Only a sermon with no date of its own ever reaches this fallback.
      coalesce(
        s.mobile_preached_on,
        s.sermon_date,
        (s.mobile_published_at at time zone 'UTC')::date
      ) as sort_date
    from public.sermons s
    join public.churches c on c.id = s.church_id
    left join public.sermon_series ss
      on ss.id = s.series_id
     and ss.church_id = s.church_id
    where c.slug = p_church_slug
      and p_relationship_state is distinct from 'blocked'
      and s.mobile_visibility <> 'none'
      and s.mobile_published_at is not null
      and s.mobile_unpublished_at is null
      and (
        s.mobile_visibility = 'public'
        or (s.mobile_visibility = 'followers'
            and p_relationship_state in ('following', 'joined'))
        or (s.mobile_visibility = 'members'
            and p_relationship_state = 'joined')
      )
      and (
        p_query is null
        or length(btrim(p_query)) = 0
        or coalesce(s.title, '') ilike '%' || btrim(p_query) || '%'
        or coalesce(s.mobile_summary, '') ilike '%' || btrim(p_query) || '%'
        or coalesce(ss.title, '') ilike '%' || btrim(p_query) || '%'
        or exists (
          select 1 from unnest(s.scripture_refs) as reference
           where reference ilike '%' || btrim(p_query) || '%'
        )
      )
  ) as history
  where
    -- Every key is descending and none is ever null (the date falls back to
    -- the publish day, and unpublished rows are filtered above), so one row
    -- comparison is an exact keyset: no row is skipped or repeated between
    -- pages, including sermons preached on the same day.
    p_cursor_id is null
    or (history.sort_date, history.published_at, history.id)
       < (p_cursor_preached, p_cursor_published, p_cursor_id)
  order by history.sort_date desc, history.published_at desc, history.id desc
  limit greatest(1, least(51, p_limit));
$$;

revoke all on function public.mobile_sermon_archive(
  text, text, text, date, timestamptz, uuid, integer
) from public, anon, authenticated;
grant execute on function public.mobile_sermon_archive(
  text, text, text, date, timestamptz, uuid, integer
) to service_role;

-- One shared sermon. Same projection as 0068 — `outline`, never `content` —
-- with the list's date fallback and the same-church series join.
create or replace function public.mobile_sermon_detail(
  p_church_slug text,
  p_relationship_state text,
  p_sermon_id uuid
)
returns table (
  id uuid,
  title text,
  summary text,
  published_at timestamptz,
  preached_on date,
  scripture_refs text[],
  series_name text,
  outline jsonb,
  discussion_questions jsonb,
  publication_version integer,
  church_name text,
  church_timezone text
)
language sql
security definer
stable
set search_path = public
as $$
  select
    s.id,
    coalesce(nullif(s.title, ''), 'Sermon') as title,
    s.mobile_summary,
    s.mobile_published_at,
    coalesce(s.mobile_preached_on, s.sermon_date),
    s.scripture_refs,
    ss.title as series_name,
    s.outline,
    (
      select a.payload
        from public.sermon_assets a
       where a.sermon_id = s.id
         and a.kind = 'discussion_questions'
       order by a.created_at desc
       limit 1
    ) as discussion_questions,
    s.mobile_publication_version,
    c.name,
    c.timezone
  from public.sermons s
  join public.churches c on c.id = s.church_id
  left join public.sermon_series ss
    on ss.id = s.series_id
   and ss.church_id = s.church_id
  where c.slug = p_church_slug
    and s.id = p_sermon_id
    and p_relationship_state is distinct from 'blocked'
    and s.mobile_visibility <> 'none'
    and s.mobile_published_at is not null
    and s.mobile_unpublished_at is null
    and (
      s.mobile_visibility = 'public'
      or (s.mobile_visibility = 'followers'
          and p_relationship_state in ('following', 'joined'))
      or (s.mobile_visibility = 'members'
          and p_relationship_state = 'joined')
    );
$$;

revoke all on function public.mobile_sermon_detail(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.mobile_sermon_detail(text, text, uuid)
  to service_role;

notify pgrst, 'reload schema';
