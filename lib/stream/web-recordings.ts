import { STREAM_RECORDINGS_BUCKET } from "@/lib/stream/recording-storage";
import {
  recordingPlaylistPath,
  signRecordingPlaybackToken,
} from "@/lib/stream/recording-playback";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The church website's view of its recordings.
 *
 * Reads only through `web_recordings` (migration 0095), which applies the same
 * eligibility the app does — published to the website, playable, not deleted.
 * Before P15 the watch page played any recording by id through a four-hour
 * signed URL, published or not.
 */

export type WebRecording = {
  id: string;
  churchId: string;
  title: string;
  summary: string | null;
  recordedAt: string;
  durationSec: number | null;
  posterUrl: string | null;
  seriesName: string | null;
  speakers: string[];
  tags: string[];
  listed: boolean;
  sourceKind: "file" | "segments";
};

function toWebRecording(row: Record<string, unknown>): WebRecording {
  const speakers = (row.speakers as string[] | null) ?? [];
  return {
    id: row.id as string,
    churchId: row.church_id as string,
    title: row.title as string,
    summary: (row.summary as string | null) ?? null,
    recordedAt: row.recorded_at as string,
    durationSec:
      row.duration_sec === null || row.duration_sec === undefined ? null : Math.round(Number(row.duration_sec)),
    posterUrl: (row.poster_url as string | null) ?? null,
    seriesName: (row.series_name as string | null) ?? null,
    speakers,
    tags: [...speakers, ...((row.chapters as string[] | null) ?? []), ...((row.topics as string[] | null) ?? [])],
    listed: Boolean(row.listed),
    sourceKind: ((row.source_kind as string) ?? "file") as WebRecording["sourceKind"],
  };
}

export async function listWebRecordings(slug: string, limit = 12): Promise<WebRecording[]> {
  const { data, error } = await createAdminClient().rpc("web_recordings", {
    p_church_slug: slug,
    p_recording_id: null,
    p_limit: limit,
  });
  if (error) return [];
  return ((data ?? []) as Record<string, unknown>[]).map(toWebRecording);
}

export async function getWebRecording(
  slug: string,
  recordingId: string,
): Promise<{ recording: WebRecording; playback: { kind: "hls" | "progressive"; url: string } | null } | null> {
  if (!/^[0-9a-f-]{36}$/i.test(recordingId)) return null;
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("web_recordings", {
    p_church_slug: slug,
    p_recording_id: recordingId,
    p_limit: 1,
  });
  if (error) return null;
  const row = ((data ?? []) as Record<string, unknown>[])[0];
  if (!row) return null;
  const recording = toWebRecording(row);

  if (recording.sourceKind === "segments") {
    const token = signRecordingPlaybackToken({
      churchId: recording.churchId,
      recordingId: recording.id,
      audience: "public",
    });
    return {
      recording,
      playback: token ? { kind: "hls", url: recordingPlaylistPath(recording.id, token) } : null,
    };
  }

  // A legacy single file keeps its signed URL, but only once it is published.
  const { data: signed } = await admin.storage
    .from(STREAM_RECORDINGS_BUCKET)
    .createSignedUrl(row.storage_path as string, 60 * 60 * 4);
  return {
    recording,
    playback: signed?.signedUrl ? { kind: "progressive", url: signed.signedUrl } : null,
  };
}
