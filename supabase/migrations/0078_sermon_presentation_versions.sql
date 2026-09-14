-- Immutable sermon presentation archive (AD-008 / Prompt 10).
--
-- The Sermon Builder row stays editable. Explicit publication inserts a new
-- version with a frozen semantic slide manifest, theme/scripture snapshots, and
-- optional rendition metadata. Editing the draft never mutates a prior version.
-- Mobile reads only these rows — never the live manuscript.

create table if not exists public.sermon_presentation_versions (
  id uuid primary key default gen_random_uuid(),
  sermon_id uuid not null references public.sermons (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  version integer not null,
  content_hash text not null,
  manifest jsonb not null,
  theme_snapshot jsonb,
  scripture_snapshot jsonb,
  mobile_visibility text not null default 'none'
    check (mobile_visibility in ('none', 'public', 'followers', 'members')),
  published_at timestamptz not null default now(),
  unpublished_at timestamptz,
  renditions jsonb not null default '{"slides":[]}'::jsonb,
  created_at timestamptz not null default now(),
  constraint sermon_presentation_versions_sermon_version_unique
    unique (sermon_id, version),
  constraint sermon_presentation_versions_version_positive
    check (version >= 1),
  constraint sermon_presentation_versions_manifest_pages
    check (jsonb_typeof(manifest->'pages') = 'array')
);

create index if not exists sermon_presentation_versions_mobile_published_idx
  on public.sermon_presentation_versions (church_id, published_at desc, id desc)
  where mobile_visibility <> 'none' and unpublished_at is null;

create index if not exists sermon_presentation_versions_sermon_id_idx
  on public.sermon_presentation_versions (sermon_id, version desc);

alter table public.sermon_presentation_versions enable row level security;

-- Tenant-scoped like sermons / sermon_assets (migration 0006).
drop policy if exists sermon_presentation_versions_select
  on public.sermon_presentation_versions;
create policy sermon_presentation_versions_select
  on public.sermon_presentation_versions
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

drop policy if exists sermon_presentation_versions_insert
  on public.sermon_presentation_versions;
create policy sermon_presentation_versions_insert
  on public.sermon_presentation_versions
  for insert to authenticated
  with check (church_id in (select public.user_church_ids()));

drop policy if exists sermon_presentation_versions_update
  on public.sermon_presentation_versions;
create policy sermon_presentation_versions_update
  on public.sermon_presentation_versions
  for update to authenticated
  using (church_id in (select public.user_church_ids()))
  with check (church_id in (select public.user_church_ids()));

drop policy if exists sermon_presentation_versions_delete
  on public.sermon_presentation_versions;
create policy sermon_presentation_versions_delete
  on public.sermon_presentation_versions
  for delete to authenticated
  using (church_id in (select public.user_church_ids()));

-- Freeze the published payload. Unpublish / audience changes may touch only
-- visibility and unpublished_at.
create or replace function public.sermon_presentation_versions_protect_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.sermon_id is distinct from old.sermon_id
     or new.church_id is distinct from old.church_id
     or new.version is distinct from old.version
     or new.content_hash is distinct from old.content_hash
     or new.manifest is distinct from old.manifest
     or new.theme_snapshot is distinct from old.theme_snapshot
     or new.scripture_snapshot is distinct from old.scripture_snapshot
     or new.renditions is distinct from old.renditions
     or new.published_at is distinct from old.published_at
     or new.created_at is distinct from old.created_at
  then
    raise exception
      'sermon_presentation_versions are immutable except mobile_visibility and unpublished_at';
  end if;
  return new;
end;
$$;

drop trigger if exists sermon_presentation_versions_immutable_trg
  on public.sermon_presentation_versions;
create trigger sermon_presentation_versions_immutable_trg
  before update on public.sermon_presentation_versions
  for each row
  execute function public.sermon_presentation_versions_protect_immutable();

-- One page of a church's published presentations, newest first.
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
    c.name,
    c.timezone,
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

-- One published presentation version (semantic manifest, never the manuscript).
create or replace function public.mobile_presentation_detail(
  p_church_slug text,
  p_relationship_state text,
  p_presentation_id uuid
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
  manifest jsonb,
  theme_snapshot jsonb,
  scripture_snapshot jsonb,
  renditions jsonb,
  church_name text,
  church_timezone text
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
    v.manifest,
    v.theme_snapshot,
    v.scripture_snapshot,
    v.renditions,
    c.name,
    c.timezone
  from public.sermon_presentation_versions v
  join public.sermons s on s.id = v.sermon_id
  join public.churches c on c.id = v.church_id
  left join public.sermon_series ss on ss.id = s.series_id
  where c.slug = p_church_slug
    and v.id = p_presentation_id
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
    );
$$;

revoke all on function public.mobile_presentation_detail(text, text, uuid)
  from public, anon, authenticated;
grant execute on function public.mobile_presentation_detail(text, text, uuid)
  to service_role;

-- Rises when anything visible is published or taken down, so a cached archive
-- ETag cannot stay current after an unpublish that leaves the page empty.
create or replace function public.mobile_presentation_version(
  p_church_slug text,
  p_relationship_state text
)
returns integer
language sql
security definer
stable
set search_path = public
as $$
  select coalesce(
    (sum(v.version) + count(*) * 1000)::integer,
    0
  )
    from public.sermon_presentation_versions v
    join public.churches c on c.id = v.church_id
   where c.slug = p_church_slug
     and p_relationship_state is distinct from 'blocked'
     and v.mobile_visibility <> 'none'
     and v.unpublished_at is null;
$$;

revoke all on function public.mobile_presentation_version(text, text)
  from public, anon, authenticated;
grant execute on function public.mobile_presentation_version(text, text)
  to service_role;

notify pgrst, 'reload schema';
