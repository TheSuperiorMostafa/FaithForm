-- The relay saves fragmented MP4 media as video/iso.segment. Migration 0148
-- allowed complete video files but omitted this segment type, so storage
-- refused the media while accepting its MP4 initialization and thumbnails.
-- Preserve existing restrictions, upload limits, privacy, and other buckets.
-- NULL/empty lists already accept all types; wildcards already cover segments.
update storage.buckets
   set allowed_mime_types = array_append(allowed_mime_types, 'video/iso.segment')
 where id = 'stream-recordings'
   and cardinality(allowed_mime_types) > 0
   and not (allowed_mime_types && array['video/iso.segment', 'video/*', '*/*']::text[]);
