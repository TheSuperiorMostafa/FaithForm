-- Live stream chat messages

create table public.stream_chat_messages (
  id uuid primary key default gen_random_uuid(),
  stream_event_id uuid not null references public.stream_events (id) on delete cascade,
  church_id uuid not null references public.churches (id) on delete cascade,
  user_id uuid references auth.users (id) on delete set null,
  author_name text not null,
  body text not null,
  hidden boolean not null default false,
  created_at timestamptz not null default now()
);

create index stream_chat_event_idx
  on public.stream_chat_messages (stream_event_id, created_at);

alter table public.stream_chat_messages enable row level security;

create policy "stream_chat_select"
  on public.stream_chat_messages
  for select
  to authenticated
  using (
    church_id in (select public.user_church_ids())
    and hidden = false
  );

create policy "stream_chat_insert"
  on public.stream_chat_messages
  for insert
  to authenticated
  with check (church_id in (select public.user_church_ids()));

create policy "stream_chat_update_admin"
  on public.stream_chat_messages
  for update
  to authenticated
  using (public.is_church_admin(church_id));

-- Public read for watch page (anon can read non-hidden messages for live events)
create policy "stream_chat_public_select"
  on public.stream_chat_messages
  for select
  to anon
  using (hidden = false);

create policy "stream_chat_public_insert"
  on public.stream_chat_messages
  for insert
  to anon
  with check (true);
