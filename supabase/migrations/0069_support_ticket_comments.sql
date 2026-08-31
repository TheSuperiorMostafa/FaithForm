-- The support ticket becomes a conversation
-- Migration 0069
--
-- Until now a ticket went one way. A church filed it and heard nothing; the
-- only place an answer could be written was `support_tickets.admin_notes`,
-- which nobody outside the control center can read. So a church waiting on us
-- could not tell a ticket being worked from a ticket being ignored, and we had
-- no way to answer one without leaving the product entirely.
--
-- These rows are the thread. Both sides write to it, both sides read it, and
-- every post is mailed to the other side — support@faithform.io in both
-- directions — so neither party has to keep a dashboard open to notice.
--
-- `admin_notes` is deliberately NOT what this replaces. Those notes were
-- written under the assumption that only we would ever read them, and they
-- stay that way; anything meant for the church is posted here instead.

create table if not exists public.support_ticket_comments (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references public.support_tickets (id) on delete cascade,

  -- Denormalized from the ticket so the read policy is a plain membership
  -- check rather than a join back through a table with its own policies.
  -- Writes only ever happen server-side, where the two are set together.
  church_id uuid references public.churches (id) on delete cascade,

  -- Who is speaking. 'platform' is us, 'church' is the church's own staff.
  -- Not derived from the author's account at read time: a staff member can be
  -- removed, and the thread still has to say who said what.
  author_role text not null check (author_role in ('platform', 'church')),
  author_user_id uuid references auth.users (id) on delete set null,

  -- Display name captured at post time, for the same reason as author_role.
  author_name text,

  body text not null,
  created_at timestamptz not null default now()
);

create index if not exists support_ticket_comments_ticket_idx
  on public.support_ticket_comments (ticket_id, created_at asc);

create index if not exists support_ticket_comments_church_idx
  on public.support_ticket_comments (church_id, created_at desc);

alter table public.support_ticket_comments enable row level security;

-- A church reads its own thread. Every write goes through a server action
-- holding the service role, which is also what decides `author_role` — a
-- church must never be able to post as us.
drop policy if exists support_ticket_comments_select on public.support_ticket_comments;
create policy support_ticket_comments_select on public.support_ticket_comments
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

revoke insert, update, delete on table public.support_ticket_comments
  from public, anon, authenticated;
grant select, insert, update, delete on table public.support_ticket_comments
  to service_role;
