import type { SupabaseClient } from "@supabase/supabase-js";

import { recordingPlaylistPath, signRecordingPlaybackToken } from "@/lib/stream/recording-playback";
import { isRecordingStoragePathForChurch, STREAM_RECORDINGS_BUCKET } from "@/lib/stream/recording-storage";

export type RecordingDownloadPlan =
  | { kind: "file"; filename: string; url: string }
  | {
    kind: "segments"; filename: string; playlistUrl: string; totalBytes: number;
    /**
     * Each init and media segment's size, keyed `init/<takeId>.mp4` or
     * `seg/<segmentId>.m4s`. Without them the browser must ask for every
     * segment's size one request at a time, which on a long service outlasts
     * the export's idle timeout before a single byte is copied.
     */
    assetBytes?: Record<string, number>;
  };

type DownloadResult =
  | { ok: true; download: RecordingDownloadPlan }
  | { ok: false; status: 404 | 409 | 503; error: string };

export function recordingDownloadFilename(title: string | null, extension: string): string {
  const cleaned = (title ?? "").normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f/\\:"*?<>|]+/g, " ")
    .replace(/\.(mp4|mov|mkv|webm|m4v)$/i, "")
    .replace(/\s+/g, " ").replace(/^\.+|\.+$/g, "").trim();
  const name = Array.from(cleaned).slice(0, 100).join("") || "Recording";
  return `${name}.${/^[a-z0-9]{1,8}$/i.test(extension) ? extension.toLowerCase() : "mp4"}`;
}

/** Called only after staff Live access is checked; every read stays church-scoped. */
export async function getRecordingDownload(
  churchId: string,
  recordingId: string,
  client: SupabaseClient,
): Promise<DownloadResult> {
  const { data: row, error } = await client.from("stream_recordings")
    .select("id, church_id, title, status, source_kind, storage_path, segment_count, total_bytes, mobile_rendition_verified_at, deleted_at")
    .eq("id", recordingId).eq("church_id", churchId).is("deleted_at", null).maybeSingle();
  if (error) return { ok: false, status: 503, error: "We couldn't prepare this download. Please try again." };
  if (!row || row.church_id !== churchId || row.deleted_at) {
    return { ok: false, status: 404, error: "That recording is no longer available." };
  }
  if (row.status !== "ready" && row.status !== "published") {
    return { ok: false, status: 409, error: row.status === "failed"
      ? "There is no saved video to download for this recording yet."
      : "This recording is still being prepared. Try again when it is ready." };
  }
  if (row.source_kind === "segments") {
    if (!row.mobile_rendition_verified_at || Number(row.segment_count) < 1) {
      return { ok: false, status: 409, error: "FaithForm is still checking this recording. Please try again shortly." };
    }
    const token = signRecordingPlaybackToken({ churchId, recordingId, audience: "staff" });
    if (!token) return { ok: false, status: 503, error: "Recording downloads are temporarily unavailable. Please try again shortly." };
    const bytes = Number(row.total_bytes);
    const assetBytes = await recordingAssetBytes(client, churchId, recordingId);
    return { ok: true, download: {
      kind: "segments", filename: recordingDownloadFilename(row.title, "mp4"),
      // Downloads preserve the original service, including material trimmed from the player.
      playlistUrl: recordingPlaylistPath(recordingId, token).replace(/index\.m3u8$/, "full.m3u8"),
      totalBytes: Number.isSafeInteger(bytes) && bytes > 0 ? bytes : 0,
      ...(assetBytes ? { assetBytes } : {}),
    } };
  }
  if (row.source_kind !== "file" || typeof row.storage_path !== "string" ||
      !isRecordingStoragePathForChurch(row.storage_path, churchId)) {
    return { ok: false, status: 404, error: "That recording is no longer available." };
  }
  const extension = row.storage_path.match(/\.([a-z0-9]{1,8})$/i)?.[1] ?? "mp4";
  const filename = recordingDownloadFilename(row.title, extension);
  const { data: signed, error: signError } = await client.storage.from(STREAM_RECORDINGS_BUCKET)
    .createSignedUrl(row.storage_path, 60 * 60, { download: filename });
  if (signError || !signed?.signedUrl) {
    return { ok: false, status: 503, error: "We couldn't prepare this download. Please try again." };
  }
  return { ok: true, download: { kind: "file", filename, url: signed.signedUrl } };
}

const positiveSize = (value: unknown) => {
  const size = Number(value);
  return Number.isSafeInteger(size) && size > 0 ? size : null;
};

/**
 * The stored size of every uploaded segment and its take's init segment.
 * Best effort: a size that is missing here is asked for by the browser instead.
 */
async function recordingAssetBytes(
  client: SupabaseClient,
  churchId: string,
  recordingId: string,
): Promise<Record<string, number> | null> {
  try {
    const sizes: Record<string, number> = {};
    const takes = new Set<string>();
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await client.from("stream_recording_segments")
        .select("id, take_id, byte_size")
        .eq("recording_id", recordingId).eq("church_id", churchId).eq("status", "uploaded")
        .order("id", { ascending: true })
        .range(offset, offset + 999);
      if (error) return null;
      for (const row of data ?? []) {
        takes.add(String(row.take_id));
        const size = positiveSize(row.byte_size);
        if (size) sizes[`seg/${row.id}.m4s`] = size;
      }
      if (!data || data.length < 1000) break;
    }
    if (takes.size) {
      const { data, error } = await client.from("stream_recording_takes")
        .select("id, init_bytes")
        .eq("church_id", churchId).in("id", [...takes]);
      if (!error) {
        for (const row of data ?? []) {
          const size = positiveSize(row.init_bytes);
          if (size) sizes[`init/${row.id}.mp4`] = size;
        }
      }
    }
    return Object.keys(sizes).length ? sizes : null;
  } catch {
    return null;
  }
}
