-- Migration 0081: Presentation and sermon PowerPoint thumbnails for mobile
--
-- Return theme_snapshot and thumbnail_url from mobile_presentation_archive so mobile clients
-- can render authentic PowerPoint slide thumbnails for sermon presentations.

drop function if exists public.mobile_presentation_archive(
  text, text, text, timestamptz, uuid, integer
);

create or replace function public.mobile_presentation_archive(
  p_church_slug text,
  p_relationship_state text,
  p_query text default null,
  p_cursor_published timestamptz default null,
  p_cursor_id uuid default null,
  p_limit integer default 20
)
returns table (
  id uuid,
  sermon_id uuid,
  version integer,
  title text,
  published_at timestamptz,
  page_count integer,
  content_hash text,
  mobile_visibility text,
  series_name text,
  scripture_refs text[],
  church_name text,
  church_timezone text,
  theme_snapshot jsonb,
  thumbnail_url text,
  cursor_published timestamptz,
  cursor_id uuid
)
language sql
security definer
stable
set search_path = public
as $$
  select
    v.id,
    v.sermon_id,
    v.version,
    coalesce(nullif(s.title, ''), 'Sermon') as title,
    v.published_at,
    coalesce(jsonb_array_length(v.manifest->'pages'), 0)::integer as page_count,
    v.content_hash,
    v.mobile_visibility,
    ss.title as series_name,
    s.scripture_refs,
    c.name as church_name,
    c.timezone as church_timezone,
    v.theme_snapshot,
    coalesce(
      v.renditions->'slides'->0->>'imageUrl',
      v.theme_snapshot->>'imageUrl'
    ) as thumbnail_url,
    v.published_at as cursor_published,
    v.id as cursor_id
  from public.sermon_presentation_versions v
  join public.sermons s on s.id = v.sermon_id
  join public.churches c on c.id = v.church_id
  left join public.sermon_series ss on ss.id = s.series_id
  where c.slug = p_church_slug
    and p_relationship_state is distinct from 'blocked'
    and v.mobile_visibility <> 'none'
    and v.published_at is not null
    and v.unpublished_at is null
    and (
      v.mobile_visibility = 'public'
      or (v.mobile_visibility = 'followers'
          and p_relationship_state in ('following', 'joined'))
      or (v.mobile_visibility = 'members'
          and p_relationship_state = 'joined')
    )
    and (
      p_query is null
      or length(btrim(p_query)) = 0
      or coalesce(s.title, '') ilike '%' || btrim(p_query) || '%'
      or coalesce(ss.title, '') ilike '%' || btrim(p_query) || '%'
      or exists (
        select 1 from unnest(s.scripture_refs) as reference
         where reference ilike '%' || btrim(p_query) || '%'
      )
    )
    and (
      p_cursor_id is null
      or (v.published_at, v.id) < (p_cursor_published, p_cursor_id)
    )
  order by v.published_at desc, v.id desc
  limit greatest(1, least(50, p_limit));
$$;

revoke all on function public.mobile_presentation_archive(
  text, text, text, timestamptz, uuid, integer
) from public, anon, authenticated;
grant execute on function public.mobile_presentation_archive(
  text, text, text, timestamptz, uuid, integer
) to service_role;
