-- Migration 0180: Shared song catalog
--
-- One shared, read-only list of song FACTS that every church can search when
-- adding a song, so nobody retypes a title, writers or CCLI number:
--
--   song_catalog                       one row per song, keyed by CCLI number
--     └─ song_catalog_public_domain_texts   full text, verified public domain only
--   songs.catalog_id ─────────────────► song_catalog (the church's own copy)
--
-- ## What is shared, and what never is
--
-- The catalog holds facts only: title, writers, copyright line, themes,
-- default key and tempo. It has NO lyrics or chart column. Each church's
-- lyrics, chord charts and files stay in its own `songs` /
-- `song_arrangements` / `song_attachments` rows (0175), under the existing
-- church-scoped RLS, linked back here by `songs.catalog_id`.
--
-- The one exception is a hymn whose text is verified public domain. Its text
-- lives in a separate table that can only point at a catalog row flagged
-- `is_public_domain`, and that flag can only be set with a verification date
-- and basis (CHECK). The composite foreign key (catalog_id, is_public_domain)
-- → song_catalog (id, is_public_domain), with the child pinned to true,
-- makes "text only for verified public domain" a database rule rather than
-- an app convention: un-flagging a row that still has text fails. The table
-- ships EMPTY; texts are added only after someone verifies them.
--
-- ## Keys
--
-- A row needs a CCLI number unless it is verified public domain (many
-- hymns have none). The CCLI number is unique (NULLs are distinct), so a
-- facts-only contribution is a plain `insert … on conflict do nothing`.
--
-- ## Access
--
-- Readable by any signed-in user (facts only, no church data). Writable only
-- by the service role: the app's server actions add facts-only rows when a
-- church saves a song with a CCLI number that is not in the catalog yet, and
-- never overwrite an existing row. No row records which church contributed it.
--
-- ## Search
--
-- pg_trgm is not used by any earlier migration, so title search uses a
-- `simple` full-text vector (prefix queries such as `amaz:*`) plus a
-- lower(title) pattern index for prefix matches; CCLI lookup uses the unique
-- index.
--
-- Additive and idempotent. Rollback: drop `songs.catalog_id`, then the two
-- tables, and restore the 0175 `songs_source_check` list without 'catalog'
-- (only after clearing rows that use it).

-- ---------------------------------------------------------------------------
-- CATALOG
-- ---------------------------------------------------------------------------

create table if not exists public.song_catalog (
  id uuid primary key default gen_random_uuid(),
  ccli_number text
    constraint song_catalog_ccli_format check (ccli_number is null or ccli_number ~ '^[0-9]{1,10}$'),
  title text not null
    constraint song_catalog_title_length check (length(btrim(title)) between 1 and 200),
  author text
    constraint song_catalog_author_length check (author is null or length(author) <= 300),
  copyright text
    constraint song_catalog_copyright_length check (copyright is null or length(copyright) <= 500),
  themes text[] not null default '{}'
    constraint song_catalog_themes_count check (cardinality(themes) <= 20),
  default_key text
    constraint song_catalog_key_length check (default_key is null or length(default_key) <= 8),
  tempo integer
    constraint song_catalog_tempo_range check (tempo is null or tempo between 20 and 300),
  -- Verified public domain. Only with a verification date and the basis for it.
  is_public_domain boolean not null default false,
  public_domain_verified_at timestamptz,
  public_domain_basis text
    constraint song_catalog_public_domain_basis_length check (public_domain_basis is null or length(public_domain_basis) <= 500),
  -- 'church': facts a church saved with a CCLI number; 'staff': added by FaithForm.
  source text not null default 'church'
    constraint song_catalog_source_check check (source in ('church', 'staff')),
  search_vector tsvector generated always as (
    to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(author, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint song_catalog_ccli_key unique (ccli_number),
  constraint song_catalog_id_public_domain_key unique (id, is_public_domain),
  constraint song_catalog_public_domain_verified check (
    not is_public_domain
    or (public_domain_verified_at is not null and length(btrim(coalesce(public_domain_basis, ''))) > 0)
  ),
  constraint song_catalog_keyed check (ccli_number is not null or is_public_domain)
);

create index if not exists song_catalog_title_prefix_idx
  on public.song_catalog (lower(title) text_pattern_ops);
create index if not exists song_catalog_search_idx
  on public.song_catalog using gin (search_vector);

-- Verified public-domain text only. Ships empty.
create table if not exists public.song_catalog_public_domain_texts (
  catalog_id uuid primary key,
  is_public_domain boolean not null default true
    constraint song_catalog_public_domain_texts_flag check (is_public_domain),
  lyrics text not null
    constraint song_catalog_public_domain_texts_length check (length(btrim(lyrics)) between 1 and 20000),
  section_order text[] not null default '{}',
  verified_by text not null
    constraint song_catalog_public_domain_texts_verified_by check (length(btrim(verified_by)) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint song_catalog_public_domain_texts_catalog_fk
    foreign key (catalog_id, is_public_domain)
    references public.song_catalog (id, is_public_domain)
    on delete cascade
);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'song_catalog_touch') then
    create trigger song_catalog_touch before update on public.song_catalog
      for each row execute function public.service_plans_touch();
  end if;
  if not exists (select 1 from pg_trigger where tgname = 'song_catalog_public_domain_texts_touch') then
    create trigger song_catalog_public_domain_texts_touch before update on public.song_catalog_public_domain_texts
      for each row execute function public.service_plans_touch();
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- CHURCH SONGS → CATALOG
-- ---------------------------------------------------------------------------

alter table public.songs
  add column if not exists catalog_id uuid references public.song_catalog (id) on delete set null;

create index if not exists songs_catalog_idx
  on public.songs (church_id, catalog_id)
  where catalog_id is not null;

-- Songs added from the catalog say so. Every existing row already satisfies
-- the wider list; NOT VALID then VALIDATE keeps the lock short.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'songs_source_check'
      and conrelid = 'public.songs'::regclass
      and pg_get_constraintdef(oid) like '%catalog%'
  ) then
    alter table public.songs drop constraint if exists songs_source_check;
    alter table public.songs add constraint songs_source_check
      check (source in ('manual', 'chordpro', 'onsong', 'songselect', 'csv', 'starter', 'catalog')) not valid;
    alter table public.songs validate constraint songs_source_check;
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- ACCESS
-- ---------------------------------------------------------------------------

alter table public.song_catalog enable row level security;
alter table public.song_catalog_public_domain_texts enable row level security;

revoke all on table public.song_catalog from public, anon, authenticated;
revoke all on table public.song_catalog_public_domain_texts from public, anon, authenticated;

grant select on table public.song_catalog to authenticated;
grant select on table public.song_catalog_public_domain_texts to authenticated;
grant select, insert, update, delete on table public.song_catalog to service_role;
grant select, insert, update, delete on table public.song_catalog_public_domain_texts to service_role;

drop policy if exists song_catalog_select on public.song_catalog;
create policy song_catalog_select on public.song_catalog
  for select to authenticated using (true);

drop policy if exists song_catalog_public_domain_texts_select on public.song_catalog_public_domain_texts;
create policy song_catalog_public_domain_texts_select on public.song_catalog_public_domain_texts
  for select to authenticated using (true);
