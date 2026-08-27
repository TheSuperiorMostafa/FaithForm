-- Remember that an event is all-day
-- Migration 0066
--
-- Google and iCloud both send a date-only event as a bare `YYYY-MM-DD`, which
-- becomes midnight UTC the moment it is stored as an instant. That instant is a
-- placeholder for a time nobody chose, and reading it back in the church's own
-- timezone walks the date backwards: a Saturday all-day event printed as Friday
-- at 8pm on the flyer, in the caption, and in the weekly email.
--
-- The calendar knows which events are all-day; the announcement row did not, so
-- anything rendered from the row alone had to guess. Now it does not have to.
-- Renderers read an all-day date in UTC and print no time at all.

alter table public.announcements
  add column if not exists all_day boolean not null default false;

comment on column public.announcements.all_day is
  'Date-only calendar entry. start_at is midnight UTC on that date and must be read in UTC, with no time shown.';
