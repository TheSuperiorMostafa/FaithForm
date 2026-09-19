import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";

import { buildVodPlaylist } from "@/lib/stream/recording-model";
import { MEDIA_BUCKET } from "@/lib/stream/recording-lifecycle";
import { ExpiringCache } from "@/lib/cache/expiring-cache";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Serving a segmented recording as HLS.
 *
 * Shared by the three front doors — the apps (`/api/media/v1/recording/...`),
 * the church website and the dashboard preview (`/api/stream/recordings/...`).
 * Each authenticates in its own way and then hands over here with a church id
 * and a recording id it has already authorized. This module never trusts a
 * path from the request: a playlist is built from FaithForm's own segment
 * index, and an init or media segment is looked up by id and checked to belong
 * to this recording before a byte is read.
 *
 * Segments are immutable (uploaded with `upsert: false`), which is what makes
 * it safe to let a player cache them privately.
 */

const PLAYLIST_HEADERS = {
  "Content-Type": "application/vnd.apple.mpegurl",
  "Cache-Control": "private, no-cache, no-store, must-revalidate",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};

/** A segment never changes, so a player may keep it for the session. */
const SEGMENT_CACHE = "private, max-age=3600, immutable";

/** No init or media segment the relay produces is anywhere near this. */
const MAX_OBJECT_BYTES = 64 * 1024 * 1024;

type SegmentRow = {
  id: string;
  take_id: string;
  seq: number;
  started_at: string;
  duration_sec: number | string;
  storage_path: string;
  uploaded_at: string | null;
};

type Recording = {
  id: string;
  church_id: string;
  source_kind: string;
  trim_start_sec: number | string | null;
  trim_end_sec: number | string | null;
  mobile_rendition_verified_at: string | null;
};

/** Parsed playlists, per instance, for a few seconds: a player asks repeatedly. */
const playlistCache = new ExpiringCache<string>(10_000);

function db(client?: SupabaseClient) {
  return client ?? createAdminClient();
}

async function loadRecording(
  client: SupabaseClient,
  churchId: string,
  recordingId: string,
): Promise<Recording | null> {
  const { data } = await client
    .from("stream_recordings")
    .select("id, church_id, source_kind, trim_start_sec, trim_end_sec, mobile_rendition_verified_at, deleted_at")
    .eq("id", recordingId)
    .eq("church_id", churchId)
    .maybeSingle();
  if (!data || data.deleted_at || data.source_kind !== "segments") return null;
  return data as unknown as Recording;
}

async function loadSegments(client: SupabaseClient, recordingId: string): Promise<SegmentRow[]> {
  const rows: SegmentRow[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await client
      .from("stream_recording_segments")
      .select("id, take_id, seq, started_at, duration_sec, storage_path, uploaded_at")
      .eq("recording_id", recordingId)
      .eq("status", "uploaded")
      .order("started_at", { ascending: true })
      .order("seq", { ascending: true })
      .range(offset, offset + 999);
    if (error) throw new Error(error.message);
    rows.push(...((data ?? []) as SegmentRow[]));
    if (!data || data.length < 1000) break;
  }
  return rows;
}

/**
 * The VOD playlist, with URIs relative to [basePath].
 *
 * `verifiedOnly` limits it to segments that existed when the recording was last
 * verified — what a congregation is served. A segment that arrived afterwards
 * appears once the lifecycle has re-verified, never before.
 */
export async function recordingPlaylistResponse(input: {
  churchId: string;
  recordingId: string;
  basePath: string;
  verifiedOnly: boolean;
  /** The whole recording, ignoring the trim — for the trim editor only. */
  ignoreTrim?: boolean;
  client?: SupabaseClient;
}): Promise<NextResponse> {
  const cacheKey = `${input.churchId}|${input.recordingId}|${input.basePath}|${input.verifiedOnly}|${Boolean(input.ignoreTrim)}`;
  const cached = playlistCache.get(cacheKey);
  if (cached !== undefined) return new NextResponse(cached, { headers: PLAYLIST_HEADERS });

  const client = db(input.client);
  const recording = await loadRecording(client, input.churchId, input.recordingId);
  if (!recording) return NextResponse.json({ error: "Unavailable" }, { status: 404 });

  let segments = await loadSegments(client, recording.id);
  if (input.verifiedOnly) {
    const verifiedAt = recording.mobile_rendition_verified_at
      ? Date.parse(recording.mobile_rendition_verified_at)
      : null;
    if (verifiedAt === null) return NextResponse.json({ error: "Unavailable" }, { status: 404 });
    segments = segments.filter(
      (segment) => segment.uploaded_at !== null && Date.parse(segment.uploaded_at) <= verifiedAt,
    );
  }
  if (segments.length === 0) return NextResponse.json({ error: "Unavailable" }, { status: 404 });

  const base = input.basePath.replace(/\/$/, "");
  const playlist = buildVodPlaylist({
    segments: segments.map((segment) => ({
      id: segment.id,
      takeId: segment.take_id,
      seq: segment.seq,
      startedAt: segment.started_at,
      durationSec: Number(segment.duration_sec),
    })),
    trimStartSec: input.ignoreTrim ? 0 : Number(recording.trim_start_sec ?? 0),
    trimEndSec:
      input.ignoreTrim || recording.trim_end_sec === null || recording.trim_end_sec === undefined
        ? null
        : Number(recording.trim_end_sec),
    // Root-relative, so the same playlist resolves on whichever origin served it.
    initUri: (takeId) => `${base}/init/${takeId}.mp4`,
    segmentUri: (segment) => `${base}/seg/${segment.id}.m4s`,
  });

  playlistCache.set(cacheKey, playlist);
  return new NextResponse(playlist, { headers: PLAYLIST_HEADERS });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Serves `init/<takeId>.mp4` or `seg/<segmentId>.m4s` for a recording the
 * caller has already been authorized to watch.
 */
export async function recordingObjectResponse(input: {
  churchId: string;
  recordingId: string;
  rest: string[];
  client?: SupabaseClient;
}): Promise<NextResponse> {
  const client = db(input.client);
  const [kind, file, ...extra] = input.rest;
  if (extra.length > 0 || !file) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let storagePath: string | null = null;
  let contentType = "video/mp4";

  if (kind === "seg" && file.endsWith(".m4s") && UUID.test(file.slice(0, -4))) {
    const { data } = await client
      .from("stream_recording_segments")
      .select("storage_path, status")
      .eq("id", file.slice(0, -4))
      .eq("recording_id", input.recordingId)
      .eq("church_id", input.churchId)
      .maybeSingle();
    if (data?.status === "uploaded") storagePath = data.storage_path as string;
    contentType = "video/iso.segment";
  } else if (kind === "init" && file.endsWith(".mp4") && UUID.test(file.slice(0, -4))) {
    const takeId = file.slice(0, -4);
    // The take must have contributed to *this* recording.
    const { data: belongs } = await client
      .from("stream_recording_segments")
      .select("id")
      .eq("recording_id", input.recordingId)
      .eq("take_id", takeId)
      .eq("church_id", input.churchId)
      .limit(1)
      .maybeSingle();
    if (belongs) {
      const { data: take } = await client
        .from("stream_recording_takes")
        .select("init_storage_path, init_status")
        .eq("id", takeId)
        .eq("church_id", input.churchId)
        .maybeSingle();
      if (take?.init_status === "uploaded") storagePath = take.init_storage_path as string;
    }
  }

  if (!storagePath) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const { data: blob, error } = await client.storage.from(MEDIA_BUCKET).download(storagePath);
  if (error || !blob) {
    // A storage error can name a bucket and a path. Only the class crosses back.
    return NextResponse.json({ error: "Playback unavailable" }, { status: 502 });
  }
  if (blob.size > MAX_OBJECT_BYTES) {
    return NextResponse.json({ error: "Playback unavailable" }, { status: 502 });
  }

  return new NextResponse(blob.stream(), {
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(blob.size),
      "Cache-Control": SEGMENT_CACHE,
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
    },
  });
}
