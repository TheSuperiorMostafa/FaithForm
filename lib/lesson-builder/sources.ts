import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Which of these lessons were made from a recording, for the "From a
 * recording" note on the Lessons list. Church-scoped; a deleted recording no
 * longer counts. A failed lookup only hides the note.
 */
export async function listLessonIdsFromRecordings(
  churchId: string,
  lessonIds: string[],
): Promise<Set<string>> {
  if (lessonIds.length === 0) return new Set();
  const { data, error } = await createAdminClient()
    .from("sermon_recording_sources")
    .select("sermon_id, stream_recordings!inner(deleted_at)")
    .eq("church_id", churchId)
    .in("sermon_id", lessonIds)
    .is("stream_recordings.deleted_at", null);
  if (error || !data) return new Set();
  return new Set(data.map((row) => row.sermon_id as string));
}
