-- Sermon notes in the member app (the destination Prompt 4 declared and no
-- prompt ever built).
--
-- The Sermon Builder's output is a *working document*. It holds drafts, style
-- notes, the audience a preacher was aiming at and the model that drafted it —
-- none of which belongs in front of a congregation. So publication here is
-- opt-in per sermon and default 'none', exactly like media, and the reader is
-- only ever shown two things: the outline, which is the structure a sermon was
-- meant to be followed by, and the discussion questions, which exist to be
-- handed out. The manuscript in `content` is deliberately never exposed.
--
-- Mirrors 0060/0061 on purpose: same column names, same visibility ladder, same
-- cursor shape. A reader who knows how media publication works knows how this
-- works, and the two can never drift into different privacy rules by accident.

alter table public.sermons
  add column if not exists mobile_visibility text not null default 'none';

alter table public.sermons
  add column if not exists mobile_published_at timestamptz;

alter table public.sermons
  add column if not exists mobile_unpublished_at timestamptz;

-- A member-facing blurb. The sermon's own `topic` is an input to the generator,
-- not a description of the finished thing, so it is not reused here.
alter table public.sermons
  add column if not exists mobile_summary text;

-- The day it was actually preached, which is rarely the day it was published.
alter table public.sermons
  add column if not exists mobile_preached_on date;

-- Bumped on every publication change so a cached copy on a phone can be
-- invalidated without diffing the body.
alter table public.sermons
  add column if not exists mobile_publication_version integer not null default 1;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'sermons_mobile_visibility_check'
  ) then
    alter table public.sermons
      add constraint sermons_mobile_visibility_check
      check (mobile_visibility in ('none', 'public', 'followers', 'members'));
  end if;
end
$$;

-- Partial: the archive only ever reads published rows, and a church's drafts
-- vastly outnumber them.
create index if not exists sermons_mobile_published_idx
  on public.sermons (church_id, mobile_published_at desc, id desc)
  where mobile_visibility <> 'none' and mobile_unpublished_at is null;

-- One page of a church's published sermon notes, newest first.
--
-- Search runs *after* the publication and relationship filters, so an
-- unpublished sermon's title cannot be discovered through the search box.
create or replace function public.mobile_sermon_archive(
  p_church_slug text,
  p_relationship_state text,
  p_query text default null,
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
  cursor_published timestamptz,
  cursor_id uuid
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
    s.mobile_preached_on,
    s.scripture_refs,
    ss.title as series_name,
    s.mobile_publication_version,
    c.name,
    c.timezone,
    s.mobile_published_at as cursor_published,
    s.id as cursor_id
  from public.sermons s
  join public.churches c on c.id = s.church_id
  left join public.sermon_series ss on ss.id = s.series_id
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
    and (
      p_cursor_id is null
      or (s.mobile_published_at, s.id) < (p_cursor_published, p_cursor_id)
    )
  order by s.mobile_published_at desc, s.id desc
  limit greatest(1, least(50, p_limit));
$$;

revoke all on function public.mobile_sermon_archive(
  text, text, text, timestamptz, uuid, integer
) from public, anon, authenticated;
grant execute on function public.mobile_sermon_archive(
  text, text, text, timestamptz, uuid, integer
) to service_role;

-- One published sermon.
--
-- Returns `outline` but never `content`: the outline is the shape of the
-- sermon, the content is the preacher's manuscript. `discussion_questions` is
-- read from the most recent asset of that kind, which is what the builder
-- writes when a preacher generates them.
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
    s.mobile_preached_on,
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
  left join public.sermon_series ss on ss.id = s.series_id
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

-- The church's sermon-publication version, for ETags.
--
-- Rises when anything published changes, so a phone holding a cached archive
-- can be told "still current" without the server rebuilding the page.
create or replace function public.mobile_sermon_version(
  p_church_slug text,
  p_relationship_state text
)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(max(s.mobile_publication_version), 0)::integer
    from public.sermons s
    join public.churches c on c.id = s.church_id
   where c.slug = p_church_slug
     and p_relationship_state is distinct from 'blocked'
     and s.mobile_visibility <> 'none';
$$;

revoke all on function public.mobile_sermon_version(text, text)
  from public, anon, authenticated;
grant execute on function public.mobile_sermon_version(text, text)
  to service_role;
