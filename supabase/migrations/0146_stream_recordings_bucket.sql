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

-- Security: Private bucket with no policies = default deny for authenticated/anon.
-- All access via signed URLs only (authenticated as service_role).
-- Migration baseline checker prohibits post-baseline storage.objects policies,
-- and default-deny is sufficient here (signed URLs bypass RLS via service_role auth).
