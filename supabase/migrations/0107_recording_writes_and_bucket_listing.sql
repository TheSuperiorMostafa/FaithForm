-- Migration 0107
--
-- Two cross-church leaks through direct API access. Additive and data-safe:
-- no row, object, column or constraint is changed; only who may write one
-- table and who may *list* two public buckets.
--
-- ## 1. Recording rows are written by the server only
--
-- 0034 gave every church admin INSERT, UPDATE and DELETE on
-- `stream_recordings` through PostgREST, with no restriction on the columns.
-- The server signs `storage_path` with the service role when staff or the
-- church website play a file recording, so an admin of one church could set
-- their own row's path to another church's recording file and be handed a
-- playable link to it — or mark rows ready and published with made-up
-- evidence. Since 0095 every write goes through the service role (the
-- lifecycle, the relay callbacks, the dashboard actions); nothing in the app
-- writes this table with a signed-in person's session, so nothing loses a
-- path it uses. Reads are unchanged.
--
-- ## 2. Public buckets serve files, not directories
--
-- A public bucket serves `/object/public/...` without any policy. The
-- `SELECT ... to public` policies on `church-covers` and `social-graphics`
-- added only the ability to *list* them with the anon key. `church-covers`
-- holds the recorder's frames under `recording-frames/<church>/<recording>/`,
-- one about every two minutes of every broadcast, published or not;
-- `social-graphics` holds draft flyers. Every upload, overwrite and removal in
-- these buckets goes through the service role, so dropping the listing policy
-- breaks no write and no public link.

drop policy if exists stream_recordings_insert on public.stream_recordings;
drop policy if exists stream_recordings_update on public.stream_recordings;
drop policy if exists stream_recordings_delete on public.stream_recordings;

revoke insert, update, delete, truncate on table public.stream_recordings from anon, authenticated;

drop policy if exists "Public read access for church covers" on storage.objects;
drop policy if exists "Public read access for social graphics" on storage.objects;
