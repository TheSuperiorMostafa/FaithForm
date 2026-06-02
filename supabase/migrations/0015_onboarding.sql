-- FaithForm: Church onboarding invites + profile fields
-- Migration 0015

-- ---------------------------------------------------------------------------
-- CHURCH INVITES
-- ---------------------------------------------------------------------------

create table public.church_invites (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  email text not null,
  admin_first_name text not null,
  admin_last_name text not null,
  token text not null unique default encode(gen_random_bytes(32), 'hex'),
  accepted_at timestamptz,
  expires_at timestamptz not null default (now() + interval '7 days'),
  created_at timestamptz default now()
);

create index church_invites_token_idx on public.church_invites (token);
create index church_invites_church_id_idx on public.church_invites (church_id);

alter table public.church_invites enable row level security;

-- No client policies: validated server-side via service role only.

-- ---------------------------------------------------------------------------
-- CHURCHES: onboarding profile fields
-- ---------------------------------------------------------------------------

alter table public.churches
  add column if not exists address text,
  add column if not exists city text,
  add column if not exists state text,
  add column if not exists zip text,
  add column if not exists website text,
  add column if not exists phone text,
  add column if not exists logo_url text,
  add column if not exists onboarding_completed_at timestamptz;

-- ---------------------------------------------------------------------------
-- CHURCH_USERS: onboarding step tracking
-- ---------------------------------------------------------------------------

alter table public.church_users
  add column if not exists onboarding_step text default 'pending';

-- Backfill existing churches that already have linked users
update public.churches c
set onboarding_completed_at = coalesce(c.onboarding_completed_at, c.created_at)
where c.onboarding_completed_at is null
  and exists (
    select 1 from public.church_users cu where cu.church_id = c.id
  );

-- ---------------------------------------------------------------------------
-- STORAGE: church-logos bucket
-- ---------------------------------------------------------------------------

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'church-logos',
  'church-logos',
  true,
  2097152,
  array['image/png', 'image/jpeg', 'image/jpg']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Authenticated users may upload to their church folder (validated in server action)
create policy "Authenticated users can upload church logos"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'church-logos'
    and (storage.foldername(name))[1] is not null
  );

create policy "Public read access for church logos"
  on storage.objects for select
  to public
  using (bucket_id = 'church-logos');

create policy "Authenticated users can update church logos"
  on storage.objects for update
  to authenticated
  using (bucket_id = 'church-logos')
  with check (bucket_id = 'church-logos');

create policy "Authenticated users can delete church logos"
  on storage.objects for delete
  to authenticated
  using (bucket_id = 'church-logos');
