-- The dashboard's "What's new" pop-up: which announcement items each staff
-- member has dismissed. Kept per sign-in, not per browser, so dismissing it on
-- one device dismisses it everywhere. Item ids come from
-- lib/releases/whats-new.ts ("update-14/lessons-from-sermons"); the content
-- itself lives in the repo, never here.
--
-- Personal display state only: removed with the Auth user, and no row ever
-- keeps a sign-in alive.
create table public.whats_new_reads (
  user_id uuid not null references auth.users(id) on delete cascade,
  item_id text not null
    constraint whats_new_reads_item_id_check
    check (char_length(item_id) between 3 and 120 and item_id ~ '^[a-z0-9][a-z0-9-]*/[a-z0-9][a-z0-9-]*$'),
  seen_at timestamptz not null default now(),
  primary key (user_id, item_id)
);

alter table public.whats_new_reads enable row level security;
revoke all on public.whats_new_reads from public, anon, authenticated;
grant select, insert on public.whats_new_reads to authenticated;
grant all on public.whats_new_reads to service_role;

-- A person reads and adds only their own rows, and only while they are on a
-- church's team. Nothing updates or deletes a dismissal from the client.
create policy whats_new_reads_select on public.whats_new_reads
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy whats_new_reads_insert on public.whats_new_reads
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.user_church_ids())
  );
