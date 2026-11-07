-- Stream recordings storage bucket for live stream uploads and relay recordings.
-- All uploads go through service-role authenticated signed URLs; recordings are
-- private until explicitly published through the recording review flow.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'stream-recordings',
  'stream-recordings',
  false,
  5368709120, -- 5 GB in bytes (MAX_RECORDING_UPLOAD_BYTES)
  array['video/mp4', 'video/quicktime', 'video/x-matroska'] -- mp4, mov, mkv
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Storage RLS: Private bucket, service_role only
-- Signed URLs work because they're authenticated as service_role
-- No policies = default deny for authenticated/anon users
-- This is intentional: all access via signed URLs only

-- Explicitly deny direct browser access (defense in depth)
create policy "stream_recordings_select_service_only"
  on storage.objects for select
  using (bucket_id = 'stream-recordings' and auth.role() = 'service_role');

create policy "stream_recordings_insert_service_only"
  on storage.objects for insert
  with check (bucket_id = 'stream-recordings' and auth.role() = 'service_role');

create policy "stream_recordings_delete_service_only"
  on storage.objects for delete
  using (bucket_id = 'stream-recordings' and auth.role() = 'service_role');
