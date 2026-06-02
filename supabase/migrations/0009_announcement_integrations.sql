-- Announcement integrations: Google Calendar link, publish tracking, OAuth tokens

alter table public.churches
  add column if not exists google_calendar_id text default 'primary';

alter table public.announcements
  add column if not exists google_event_id text,
  add column if not exists google_calendar_id text,
  add column if not exists facebook_post_id text,
  add column if not exists gmail_draft_id text,
  add column if not exists published_at timestamptz,
  add column if not exists published_by uuid references auth.users (id) on delete set null,
  add column if not exists last_publish_error text;

create unique index if not exists announcements_church_google_event_idx
  on public.announcements (church_id, google_event_id)
  where google_event_id is not null;

-- ---------------------------------------------------------------------------
-- CHURCH INTEGRATIONS (OAuth tokens — server/admin access only)
-- ---------------------------------------------------------------------------

create table public.church_integrations (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,
  provider text not null check (provider in ('google', 'facebook')),
  access_token text not null,
  refresh_token text,
  token_expires_at timestamptz,
  metadata jsonb not null default '{}',
  connected_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (church_id, provider)
);

create or replace function public.set_church_integrations_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists church_integrations_updated_at on public.church_integrations;

create trigger church_integrations_updated_at
  before update on public.church_integrations
  for each row execute function public.set_church_integrations_updated_at();

alter table public.church_integrations enable row level security;

-- Admins can see that integrations exist (not token values via select *)
create policy "church_integrations_select"
  on public.church_integrations
  for select
  to authenticated
  using (
    church_id in (select public.user_church_ids())
    and public.is_church_admin(church_id)
  );

create policy "church_integrations_insert"
  on public.church_integrations
  for insert
  to authenticated
  with check (public.is_church_admin(church_id));

create policy "church_integrations_update"
  on public.church_integrations
  for update
  to authenticated
  using (public.is_church_admin(church_id))
  with check (public.is_church_admin(church_id));

create policy "church_integrations_delete"
  on public.church_integrations
  for delete
  to authenticated
  using (public.is_church_admin(church_id));
