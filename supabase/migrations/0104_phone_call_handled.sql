-- Phone calls can be marked handled
-- Migration 0104
--
-- The Phone Calls page opens on "Needs a call back": real callers the phone
-- assistant's rubric said a person at the church should ring back. Without a
-- way to say "done", that list only ever grew. These two columns record who
-- dealt with a call and when; clearing them puts the call back on the list.
--
-- Both are nullable and nothing else reads them, so the dashboard works the
-- same before and after this runs (it hides "Mark as handled" until it has).
-- Writes go through the existing admin-only `phone_calls_update` policy.

alter table public.phone_calls
  add column if not exists handled_at timestamptz,
  add column if not exists handled_by uuid references auth.users (id) on delete set null;

create index if not exists phone_calls_church_unhandled_idx
  on public.phone_calls (church_id, called_at desc)
  where handled_at is null;
