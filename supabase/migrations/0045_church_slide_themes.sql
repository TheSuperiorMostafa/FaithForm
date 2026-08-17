-- Church-uploaded slide themes
-- Migration 0045
--
-- A church can upload its own background image and reuse it on later decks.
-- Rather than a second table, uploads are ordinary slide_themes rows tagged
-- with the owning church — every reader (picker, PPTX export, PDF) already
-- understands that shape, so nothing downstream has to branch.
--
-- church_id null  = platform catalog, visible to everyone (unchanged)
-- church_id set   = that church's upload, visible only to that church

alter table public.slide_themes
  add column if not exists church_id uuid
    references public.churches (id) on delete cascade,
  add column if not exists created_by uuid
    references auth.users (id) on delete set null;

create index if not exists slide_themes_church_id_idx
  on public.slide_themes (church_id, sort_order)
  where church_id is not null;

-- The catalog is keyed on a text id; uploads get a generated one, so keep the
-- global catalog's ids from ever colliding with an upload's.
alter table public.slide_themes
  drop constraint if exists slide_themes_upload_id_prefix;
alter table public.slide_themes
  add constraint slide_themes_upload_id_prefix
  check (church_id is null or id like 'upload-%');

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- Replaces the blanket "any active theme" read policy from 0021: the platform
-- catalog stays public, but an upload is only readable by its own church.

drop policy if exists slide_themes_select on public.slide_themes;
create policy slide_themes_select on public.slide_themes
  for select to anon, authenticated
  using (
    active = true
    and (
      church_id is null
      or exists (
        select 1
        from public.church_users cu
        where cu.user_id = auth.uid()
          and cu.church_id = slide_themes.church_id
      )
    )
  );

drop policy if exists slide_themes_insert_own on public.slide_themes;
create policy slide_themes_insert_own on public.slide_themes
  for insert to authenticated
  with check (
    church_id is not null
    and exists (
      select 1
      from public.church_users cu
      where cu.user_id = auth.uid()
        and cu.church_id = slide_themes.church_id
    )
  );

drop policy if exists slide_themes_delete_own on public.slide_themes;
create policy slide_themes_delete_own on public.slide_themes
  for delete to authenticated
  using (
    church_id is not null
    and exists (
      select 1
      from public.church_users cu
      where cu.user_id = auth.uid()
        and cu.church_id = slide_themes.church_id
    )
  );
