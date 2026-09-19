-- FaithForm: the events a church runs again and again, in its own words
-- Migration 0086
--
-- Announcement captions and flyers were written from a calendar title and
-- nothing else. "Men's Breakfast" told the writer it was a breakfast; it could
-- not know that it happens on the first Saturday of every month, that it is
-- for men of every age, that the church wants it to sound relaxed rather than
-- solemn, or that the flyer should feel like cast iron and lantern light. The
-- image model knew even less.
--
-- These rows are that knowledge. FaithForm staff keep them on the church's
-- profile in the admin console, and the announcement writer looks up the row
-- an event's title matches (by its name or any other name it goes by) and
-- writes from it.
--
-- Deliberately separate from `church_service_times`. Those rows drive
-- attendance occurrences and the public website, so they have to stay
-- machine-readable: a weekday and a clock time. `cadence` here is free text
-- for a person and a model to read ("First Saturday of the month"), and
-- nothing is ever scheduled from it.

create table if not exists public.church_recurring_events (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,

  -- What the church calls it, and the other names it turns up under on a
  -- calendar ("Brothers' Table", "Men's Prayer Breakfast").
  name text not null,
  aliases text[] not null default '{}',

  -- All free text, all optional.
  cadence text,
  description text,
  audience text,
  tone text,
  caption_notes text,
  visual_notes text,

  -- Off means "don't use this when writing announcements", without losing
  -- what was written. A seasonal event is paused rather than deleted.
  is_active boolean not null default true,
  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references auth.users (id) on delete set null,

  constraint church_recurring_events_name_present
    check (length(btrim(name)) > 0)
);

-- One event per name per church, ignoring case. Also the lookup index: every
-- read is "this church's events".
create unique index if not exists church_recurring_events_church_name_idx
  on public.church_recurring_events (church_id, lower(name));

-- ---------------------------------------------------------------------------
-- UPDATED_AT
-- ---------------------------------------------------------------------------

create or replace function public.set_church_recurring_events_updated_at()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists church_recurring_events_updated_at
  on public.church_recurring_events;
create trigger church_recurring_events_updated_at
  before update on public.church_recurring_events
  for each row execute function public.set_church_recurring_events_updated_at();

-- ---------------------------------------------------------------------------
-- ROW LEVEL SECURITY
-- ---------------------------------------------------------------------------
--
-- A church's own people may read their church's rows, as with service times
-- and staff (migration 0038). Every write goes through the admin console,
-- which holds the service role: churches do not edit their profile, FaithForm
-- staff do it for them.

alter table public.church_recurring_events enable row level security;

drop policy if exists church_recurring_events_select
  on public.church_recurring_events;
create policy church_recurring_events_select
  on public.church_recurring_events
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

revoke insert, update, delete on table public.church_recurring_events
  from public, anon, authenticated;
grant select, insert, update, delete on table public.church_recurring_events
  to service_role;

notify pgrst, 'reload schema';
