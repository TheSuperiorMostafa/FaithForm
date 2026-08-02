-- FaithForm: multi-tenant church websites
-- Migration 0042
--
-- One codebase renders every church's public site. Everything church-specific
-- lives in these tables; no component ever branches on which church it is.
--
-- The church profile itself is NOT duplicated here. Sites read the existing
-- churches / church_service_times / church_staff tables from migration 0038.
-- These tables only add what a *website* needs on top of that profile.
--
-- Naming note: everything is prefixed `site_` because `slide_themes` (0021)
-- and /admin/themes already own the word "themes" for sermon presentations.

-- ---------------------------------------------------------------------------
-- SHARED TRIGGER
-- ---------------------------------------------------------------------------

create or replace function public.set_site_tables_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- DOMAINS  (hostname -> church)
-- ---------------------------------------------------------------------------
-- Resolution ships now so a manually inserted row works immediately.
-- Automated provisioning through the Vercel API is a later step.

create table if not exists public.site_domains (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  -- Stored lowercase and without port so middleware can match on it directly.
  hostname text not null unique check (hostname = lower(hostname)),
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists site_domains_church_id_idx
  on public.site_domains (church_id);

-- At most one primary hostname per church.
create unique index if not exists site_domains_one_primary_idx
  on public.site_domains (church_id)
  where is_primary;

-- ---------------------------------------------------------------------------
-- THEMES  (global structural baselines, not church-scoped)
-- ---------------------------------------------------------------------------

create table if not exists public.site_themes (
  id uuid primary key default gen_random_uuid(),
  key text not null unique,
  name text not null,
  description text,
  -- CSS custom properties, e.g. {"--site-accent": "#AED8F5"}. Merged under the
  -- church's brand_tokens at render time.
  tokens jsonb not null default '{}'::jsonb,
  -- Per-section-type defaults, e.g. {"hero": {"surface": "ink"}}. Cascade
  -- level 2, sitting between master defaults and profile-derived content.
  section_defaults jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- PER-CHURCH SITE SETTINGS
-- ---------------------------------------------------------------------------

create table if not exists public.site_settings (
  church_id uuid primary key references public.churches (id) on delete cascade,
  theme_key text not null default 'grace' references public.site_themes (key)
    on update cascade,
  -- Brand tokens layered over the theme's tokens. Same shape.
  brand_tokens jsonb not null default '{}'::jsonb,
  -- Escape hatch. Only ever loaded on this church's own pages, which is what
  -- walls it off; there is no cross-church surface to leak onto.
  custom_css text,
  -- Where the Visit contact form is delivered. Falls back to churches.email.
  contact_email text,
  is_published boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- PAGES
-- ---------------------------------------------------------------------------
-- v1 only seeds '/', but retrofitting a page dimension later would mean
-- rewriting every section row, so it goes in now.

create table if not exists public.site_pages (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  path text not null default '/' check (path like '/%'),
  title text,
  meta_description text,
  status text not null default 'draft' check (status in ('draft', 'published')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (church_id, path)
);

create index if not exists site_pages_church_id_idx
  on public.site_pages (church_id);

-- ---------------------------------------------------------------------------
-- SECTIONS  (the ordered page config)
-- ---------------------------------------------------------------------------
-- This table is regenerable: the AI generation step rewrites it from the church
-- profile. That is precisely why hand edits live in site_overrides instead of
-- here -- regenerating a config must never destroy manual adjustments.

create table if not exists public.site_sections (
  id uuid primary key default gen_random_uuid(),
  page_id uuid not null references public.site_pages (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  type text not null,
  sort_order integer not null default 0,
  is_visible boolean not null default true,
  props jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_sections_page_id_idx
  on public.site_sections (page_id, sort_order);

create index if not exists site_sections_church_id_idx
  on public.site_sections (church_id);

-- ---------------------------------------------------------------------------
-- OVERRIDES  (hand-authored patches, deep-merged last)
-- ---------------------------------------------------------------------------

create table if not exists public.site_overrides (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  scope text not null check (scope in ('church', 'page', 'section')),
  page_id uuid references public.site_pages (id) on delete cascade,
  section_id uuid references public.site_sections (id) on delete cascade,
  patch jsonb not null default '{}'::jsonb,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Each scope must carry exactly the target it needs and nothing else.
  constraint site_overrides_scope_target check (
    (scope = 'church'  and page_id is null     and section_id is null) or
    (scope = 'page'    and page_id is not null and section_id is null) or
    (scope = 'section' and section_id is not null)
  )
);

-- Partial uniques, because a plain unique constraint over nullable columns
-- would let unlimited duplicate church-scope rows through (NULL <> NULL).
create unique index if not exists site_overrides_church_scope_idx
  on public.site_overrides (church_id) where scope = 'church';

create unique index if not exists site_overrides_page_scope_idx
  on public.site_overrides (page_id) where scope = 'page';

create unique index if not exists site_overrides_section_scope_idx
  on public.site_overrides (section_id) where scope = 'section';

create index if not exists site_overrides_church_id_idx
  on public.site_overrides (church_id);

-- ---------------------------------------------------------------------------
-- MEDIA  (the public sermon archive)
-- ---------------------------------------------------------------------------
-- Deliberately separate from `sermons` (0006), which is a drafting tool holding
-- outlines and generated content with no video URL, and from stream_recordings
-- (0034), which only exists for churches streaming through FaithForm.

create table if not exists public.site_media (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  title text not null,
  series text,
  speaker text,
  description text,
  published_at date,
  video_url text,
  thumbnail_url text,
  duration_sec integer,
  sort_order integer not null default 0,
  is_published boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists site_media_church_id_idx
  on public.site_media (church_id, published_at desc nulls last, sort_order);

-- ---------------------------------------------------------------------------
-- CONTACT SUBMISSIONS  (the Visit form)
-- ---------------------------------------------------------------------------
-- Rows are written by the public API route through the service-role client and
-- stored *before* the email is attempted, so a Resend outage never silently
-- drops a visitor.

create table if not exists public.site_contact_submissions (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  name text not null,
  email text not null,
  phone text,
  message text,
  source text not null default 'visit',
  status text not null default 'new' check (status in ('new', 'read', 'archived')),
  emailed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists site_contact_submissions_church_id_idx
  on public.site_contact_submissions (church_id, created_at desc);

-- ---------------------------------------------------------------------------
-- UPDATED_AT TRIGGERS
-- ---------------------------------------------------------------------------

drop trigger if exists site_themes_updated_at on public.site_themes;
create trigger site_themes_updated_at
  before update on public.site_themes
  for each row execute function public.set_site_tables_updated_at();

drop trigger if exists site_settings_updated_at on public.site_settings;
create trigger site_settings_updated_at
  before update on public.site_settings
  for each row execute function public.set_site_tables_updated_at();

drop trigger if exists site_pages_updated_at on public.site_pages;
create trigger site_pages_updated_at
  before update on public.site_pages
  for each row execute function public.set_site_tables_updated_at();

drop trigger if exists site_sections_updated_at on public.site_sections;
create trigger site_sections_updated_at
  before update on public.site_sections
  for each row execute function public.set_site_tables_updated_at();

drop trigger if exists site_overrides_updated_at on public.site_overrides;
create trigger site_overrides_updated_at
  before update on public.site_overrides
  for each row execute function public.set_site_tables_updated_at();

drop trigger if exists site_media_updated_at on public.site_media;
create trigger site_media_updated_at
  before update on public.site_media
  for each row execute function public.set_site_tables_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
-- No `anon` policies anywhere. Public rendering goes through the service-role
-- client with explicit column allowlists, the same way /give/[slug] already
-- reads churches. That keeps stripe ids, ai_knowledge and contact submissions
-- unreachable from the browser even if a key leaks into client code.

alter table public.site_domains enable row level security;
alter table public.site_themes enable row level security;
alter table public.site_settings enable row level security;
alter table public.site_pages enable row level security;
alter table public.site_sections enable row level security;
alter table public.site_overrides enable row level security;
alter table public.site_media enable row level security;
alter table public.site_contact_submissions enable row level security;

-- site_domains: readable by the church, writable only by platform admins
-- (service role), since a hostname claim affects DNS routing for everyone.
drop policy if exists site_domains_select on public.site_domains;
create policy site_domains_select on public.site_domains
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

-- site_themes: any signed-in user may read the catalog to pick a theme.
-- Theme rows are product surface, authored by us through the service role.
drop policy if exists site_themes_select on public.site_themes;
create policy site_themes_select on public.site_themes
  for select to authenticated
  using (is_active);

-- site_settings
drop policy if exists site_settings_select on public.site_settings;
create policy site_settings_select on public.site_settings
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

drop policy if exists site_settings_insert on public.site_settings;
create policy site_settings_insert on public.site_settings
  for insert to authenticated
  with check (public.is_church_admin(church_id));

-- custom_css is raw CSS injected into the page. Church admins may set it;
-- it can only ever load on their own site, which is the wall.
drop policy if exists site_settings_update on public.site_settings;
create policy site_settings_update on public.site_settings
  for update to authenticated
  using (public.is_church_admin(church_id))
  with check (public.is_church_admin(church_id));

-- site_pages
drop policy if exists site_pages_select on public.site_pages;
create policy site_pages_select on public.site_pages
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

drop policy if exists site_pages_insert on public.site_pages;
create policy site_pages_insert on public.site_pages
  for insert to authenticated
  with check (public.is_church_admin(church_id));

drop policy if exists site_pages_update on public.site_pages;
create policy site_pages_update on public.site_pages
  for update to authenticated
  using (public.is_church_admin(church_id))
  with check (public.is_church_admin(church_id));

drop policy if exists site_pages_delete on public.site_pages;
create policy site_pages_delete on public.site_pages
  for delete to authenticated
  using (public.is_church_admin(church_id));

-- site_sections
drop policy if exists site_sections_select on public.site_sections;
create policy site_sections_select on public.site_sections
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

-- `custom_embed` renders unsanitized HTML, so church admins may not create or
-- convert a section into one. Platform admins write it through the service-role
-- client, which bypasses RLS. Revisit when the pastor-facing editor ships.
drop policy if exists site_sections_insert on public.site_sections;
create policy site_sections_insert on public.site_sections
  for insert to authenticated
  with check (public.is_church_admin(church_id) and type <> 'custom_embed');

drop policy if exists site_sections_update on public.site_sections;
create policy site_sections_update on public.site_sections
  for update to authenticated
  using (public.is_church_admin(church_id) and type <> 'custom_embed')
  with check (public.is_church_admin(church_id) and type <> 'custom_embed');

drop policy if exists site_sections_delete on public.site_sections;
create policy site_sections_delete on public.site_sections
  for delete to authenticated
  using (public.is_church_admin(church_id));

-- site_overrides
drop policy if exists site_overrides_select on public.site_overrides;
create policy site_overrides_select on public.site_overrides
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

drop policy if exists site_overrides_insert on public.site_overrides;
create policy site_overrides_insert on public.site_overrides
  for insert to authenticated
  with check (public.is_church_admin(church_id));

drop policy if exists site_overrides_update on public.site_overrides;
create policy site_overrides_update on public.site_overrides
  for update to authenticated
  using (public.is_church_admin(church_id))
  with check (public.is_church_admin(church_id));

drop policy if exists site_overrides_delete on public.site_overrides;
create policy site_overrides_delete on public.site_overrides
  for delete to authenticated
  using (public.is_church_admin(church_id));

-- site_media
drop policy if exists site_media_select on public.site_media;
create policy site_media_select on public.site_media
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

drop policy if exists site_media_insert on public.site_media;
create policy site_media_insert on public.site_media
  for insert to authenticated
  with check (public.is_church_admin(church_id));

drop policy if exists site_media_update on public.site_media;
create policy site_media_update on public.site_media
  for update to authenticated
  using (public.is_church_admin(church_id))
  with check (public.is_church_admin(church_id));

drop policy if exists site_media_delete on public.site_media;
create policy site_media_delete on public.site_media
  for delete to authenticated
  using (public.is_church_admin(church_id));

-- site_contact_submissions: church members read their own leads. Inserts come
-- only from the public API route via the service role -- there is deliberately
-- no insert policy, so an anon key cannot be used to spam the table directly.
drop policy if exists site_contact_submissions_select on public.site_contact_submissions;
create policy site_contact_submissions_select on public.site_contact_submissions
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

drop policy if exists site_contact_submissions_update on public.site_contact_submissions;
create policy site_contact_submissions_update on public.site_contact_submissions
  for update to authenticated
  using (church_id in (select public.user_church_ids()))
  with check (church_id in (select public.user_church_ids()));

-- ---------------------------------------------------------------------------
-- SEED: structural themes
-- ---------------------------------------------------------------------------
-- `grace` is the Louisville Grace design, tokenised exactly. `classic` is the
-- same component set under a different token pass plus a couple of structural
-- switches, which is what proves the theme layer actually carries visual
-- variety rather than the components doing it.

insert into public.site_themes (key, name, description, tokens, section_defaults)
values
  (
    'grace',
    'Grace',
    'Contemporary and warm. Deep indigo over cream, pale-blue accent, oversized display type with a serif italic counterpoint.',
    jsonb_build_object(
      '--site-ink', '#2E2B46',
      '--site-ink-strong', '#26233b',
      '--site-ink-soft', '#33304d',
      '--site-accent', '#AED8F5',
      '--site-accent-ink', '#2E2B46',
      '--site-canvas', '#f6f4ee',
      '--site-canvas-alt', '#efece4',
      '--site-gold', '#8f7a52',
      '--site-body', '#5a5770',
      '--site-muted', '#7a7690',
      '--site-muted-soft', '#8a86a0',
      '--site-surface', '#ffffff',
      '--site-font-display', '''Bricolage Grotesque'', system-ui, sans-serif',
      '--site-font-body', '''Instrument Sans'', system-ui, sans-serif',
      '--site-font-accent', '''Newsreader'', Georgia, serif',
      '--site-radius-card', '18px',
      '--site-radius-btn', '8px',
      '--site-radius-panel', '22px',
      '--site-section-y', '96px',
      '--site-section-x', '46px',
      '--site-display-xl', '116px',
      '--site-display-lg', '50px',
      '--site-display-md', '46px',
      '--site-heading-tracking', '-0.025em',
      '--site-max-width', '1280px'
    ),
    jsonb_build_object(
      'hero', jsonb_build_object('surface', 'ink', 'align', 'split'),
      'service_times', jsonb_build_object('surface', 'ink', 'columns', 4),
      'about_text', jsonb_build_object('surface', 'canvas', 'align', 'split'),
      'vision_mission', jsonb_build_object('surface', 'ink', 'align', 'center'),
      'staff_grid', jsonb_build_object('surface', 'canvas-alt', 'align', 'split', 'columns', 4),
      'programs_grid', jsonb_build_object('surface', 'ink', 'align', 'split', 'columns', 3),
      'events_list', jsonb_build_object('surface', 'canvas', 'align', 'split'),
      'visit_cta', jsonb_build_object('surface', 'accent'),
      'sermon_feed', jsonb_build_object('surface', 'ink', 'align', 'split'),
      'give_cta', jsonb_build_object('surface', 'canvas'),
      'footer_map', jsonb_build_object('surface', 'ink-strong')
    )
  ),
  (
    'classic',
    'Classic',
    'Traditional and restrained. Ivory over deep green, gold accent, centred section headers and tighter display type.',
    jsonb_build_object(
      '--site-ink', '#1F3B2C',
      '--site-ink-strong', '#16291F',
      '--site-ink-soft', '#2C4A39',
      '--site-accent', '#C9A227',
      '--site-accent-ink', '#16291F',
      '--site-canvas', '#FBF9F4',
      '--site-canvas-alt', '#F2EEE4',
      '--site-gold', '#8A6D2F',
      '--site-body', '#4A5A50',
      '--site-muted', '#6E7C73',
      '--site-muted-soft', '#8A968E',
      '--site-surface', '#ffffff',
      '--site-font-display', '''Newsreader'', Georgia, serif',
      '--site-font-body', '''Instrument Sans'', system-ui, sans-serif',
      '--site-font-accent', '''Newsreader'', Georgia, serif',
      '--site-radius-card', '6px',
      '--site-radius-btn', '4px',
      '--site-radius-panel', '8px',
      '--site-section-y', '84px',
      '--site-section-x', '46px',
      '--site-display-xl', '82px',
      '--site-display-lg', '42px',
      '--site-display-md', '38px',
      '--site-heading-tracking', '-0.01em',
      '--site-max-width', '1180px'
    ),
    jsonb_build_object(
      'hero', jsonb_build_object('surface', 'ink', 'align', 'center'),
      'service_times', jsonb_build_object('surface', 'ink', 'columns', 3),
      'about_text', jsonb_build_object('surface', 'canvas', 'align', 'center'),
      'vision_mission', jsonb_build_object('surface', 'canvas-alt', 'align', 'center'),
      'staff_grid', jsonb_build_object('surface', 'canvas', 'align', 'center', 'columns', 3),
      'programs_grid', jsonb_build_object('surface', 'canvas-alt', 'align', 'center', 'columns', 3),
      'events_list', jsonb_build_object('surface', 'canvas', 'align', 'center'),
      'visit_cta', jsonb_build_object('surface', 'ink'),
      'sermon_feed', jsonb_build_object('surface', 'canvas', 'align', 'center'),
      'give_cta', jsonb_build_object('surface', 'canvas-alt'),
      'footer_map', jsonb_build_object('surface', 'ink-strong')
    )
  )
on conflict (key) do update set
  name = excluded.name,
  description = excluded.description,
  tokens = excluded.tokens,
  section_defaults = excluded.section_defaults;

notify pgrst, 'reload schema';
