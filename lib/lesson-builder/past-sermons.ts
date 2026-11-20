import "server-only";

import { guardFeature } from "@/lib/features/guard";
import { getSermonMediaSettings } from "@/lib/sermon-media/access";
import { formatRecordingDate, recordingDateValue } from "@/lib/stream/recording-date";
import { createAdminClient } from "@/lib/supabase/admin";

export type PastSermonOption = {
  /** The recording the lesson is built from. */
  id: string;
  title: string;
  /** Service day as YYYY-MM-DD in the church's time zone. */
  date: string;
  /** The same day for people, e.g. "Sun, Nov 16, 2026". */
  when: string;
};

export type PastSermons = {
  /** Transcripts are on for this church and this person may use them. */
  available: boolean;
  sermons: PastSermonOption[];
};

const LIMIT = 200;

/**
 * Past sermons a lesson can be built from: the church's recordings that have a
 * transcript, newest first. Church-scoped; deleted recordings are left out. A
 * failed lookup only empties the list, so "New lesson" still works.
 */
export async function listPastSermonsForLessons(churchId: string, timeZone: string): Promise<PastSermons> {
  try {
    const [settings, live, media] = await Promise.all([
      getSermonMediaSettings(churchId),
      guardFeature("live_stream"),
      guardFeature("sermon_media"),
    ]);
    if (!settings.enabled || !live.ok || !media.ok) return { available: false, sermons: [] };

    const { data, error } = await createAdminClient()
      .from("recording_sermon_media")
      .select("recording_id, stream_recordings!inner(title, created_at, service_date, deleted_at)")
      .eq("church_id", churchId)
      .not("current_transcript_version", "is", null)
      .is("stream_recordings.deleted_at", null)
      .limit(LIMIT);
    if (error || !data) return { available: true, sermons: [] };

    const sermons = data
      .map((row) => {
        const recording = row.stream_recordings as unknown as {
          title: string | null;
          created_at: string;
          service_date: string | null;
        };
        return {
          id: row.recording_id as string,
          title: recording.title?.trim() || "Untitled sermon",
          date: recordingDateValue(recording.created_at, timeZone, recording.service_date),
          when: formatRecordingDate(recording.created_at, timeZone, recording.service_date),
          createdAt: recording.created_at,
        };
      })
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt))
      .map(({ id, title, date, when }) => ({ id, title, date, when }));
    return { available: true, sermons };
  } catch {
    return { available: false, sermons: [] };
  }
}
