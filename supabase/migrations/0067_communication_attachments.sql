-- Files that ride along with the weekly announcement email
-- Migration 0067
--
-- A church that sends a weekly email eventually wants to send something with
-- it: the bulletin, a sign-up sheet, a flyer for the retreat. Until now the
-- draft was a single-part HTML message with nowhere to put one.
--
-- The rows here are the church's standing attachment list — what goes out with
-- every weekly draft — not a per-send record. Removing a row stops the file
-- being attached to future drafts and leaves drafts already created alone.
--
-- The bytes live in the private `communication-attachments` bucket, created by
-- `pnpm storage:buckets`. Nothing reads that bucket from a browser: uploads and
-- the Gmail draft both go through the server with the service role, so the file
-- is never given a public URL.

create table if not exists public.communication_attachments (
  id uuid primary key default gen_random_uuid(),
  church_id uuid not null references public.churches (id) on delete cascade,

  -- `<church_id>/<uuid>.<ext>` in the bucket. Unique so a retried upload can
  -- never leave two rows pointing at one object.
  storage_path text not null unique,

  -- The name the person chose, shown in settings and used as the filename in
  -- the sent message.
  file_name text not null,
  mime_type text not null,
  size_bytes bigint not null,

  uploaded_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists communication_attachments_church_idx
  on public.communication_attachments (church_id, created_at desc);

alter table public.communication_attachments enable row level security;

-- A church may see its own list; every write goes through a server action
-- holding the service role, which also owns the storage object the row names.
drop policy if exists communication_attachments_select on public.communication_attachments;
create policy communication_attachments_select on public.communication_attachments
  for select to authenticated
  using (church_id in (select public.user_church_ids()));

revoke insert, update, delete on table public.communication_attachments
  from public, anon, authenticated;
grant select, insert, update, delete on table public.communication_attachments
  to service_role;
