-- Extend announcements for start/end scheduling and ready-to-share auto-publish

alter table public.announcements
  add column if not exists title text,
  add column if not exists body text not null default '',
  add column if not exists start_at timestamptz,
  add column if not exists end_at timestamptz,
  add column if not exists is_ready boolean not null default false,
  add column if not exists updated_at timestamptz not null default now(),
  add column if not exists created_by uuid references auth.users (id) on delete set null;

-- Backfill from legacy calendar fields
update public.announcements
set
  title = coalesce(title, event_title),
  start_at = coalesce(start_at, event_date),
  body = coalesce(nullif(body, ''), notes, '')
where title is null or start_at is null;

create or replace function public.set_announcements_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists announcements_updated_at on public.announcements;

create trigger announcements_updated_at
  before update on public.announcements
  for each row execute function public.set_announcements_updated_at();

create or replace view public.announcements_with_status as
select
  a.id,
  a.church_id,
  coalesce(a.title, a.event_title) as title,
  coalesce(nullif(a.body, ''), a.notes, '') as body,
  coalesce(a.start_at, a.event_date) as start_at,
  a.end_at,
  a.is_ready,
  a.created_by,
  a.created_at,
  a.updated_at,
  case
    when not a.is_ready then 'draft'
    when a.is_ready and now() < coalesce(a.start_at, a.event_date) then 'scheduled'
    when a.is_ready
      and a.end_at is not null
      and now() > a.end_at then 'ended'
    when a.is_ready
      and now() >= coalesce(a.start_at, a.event_date)
      and (a.end_at is null or now() <= a.end_at) then 'active'
    else 'draft'
  end as status
from public.announcements a;
