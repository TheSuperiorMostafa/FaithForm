import type { SupabaseClient } from "@supabase/supabase-js";

import { mediaPlaybackConfigured } from "@/lib/media/v1/playback-capability";
import { isPreviewIngestActive } from "@/lib/stream/preview-ingest";
import { advanceRecording } from "@/lib/stream/recording-lifecycle";
import {
  describeStreamHealth,
  liveRecordingIndicator,
  RELAY_HEARTBEAT_TTL_MS,
  type HealthNote,
  type RecordingIndicator,
} from "@/lib/stream/recording-model";
import {
  getStaffRecording,
  getStaffRecordingForSession,
  type StaffRecording,
} from "@/lib/stream/recording-publication";
import { productionLifecycleDeps } from "@/lib/stream/recording-runtime";
import {
  recordingPlaybackConfigured,
  recordingPlaylistPath,
  signRecordingPlaybackToken,
} from "@/lib/stream/recording-playback";
import { getActiveStreamSession, type StreamSession } from "@/lib/stream/sessions";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Everything the Live screen needs to answer, at a glance:
 *
 *   What am I streaming? When? Is everything ready? How do I go live?
 *   Is it live? Is FaithForm recording it?
 *
 * Derived only from server state — the session row, the relay's heartbeats and
 * the segments FaithForm has acknowledged. The browser never decides whether a
 * service is live or being recorded; it renders this.
 */

export type BroadcastPhase =
  /** Nothing on air. The screen offers Go Live (and shows what is next). */
  | "idle"
  /** Go Live was pressed and FaithForm is waiting for video. */
  | "waiting_for_video"
  | "live"
  /** Ended recently; its recording is being prepared, is ready, or published. */
  | "post_live";

export type BroadcastOverview = {
  phase: BroadcastPhase;
  session: {
    id: string;
    title: string | null;
    status: StreamSession["status"];
    startedAt: string;
    liveSince: string | null;
    endedAt: string | null;
  } | null;
  video: {
    arriving: boolean;
    health: HealthNote[];
    /** Technical detail, for the Stream health panel only. */
    stats: {
      bitrateKbps: number | null;
      resolution: string | null;
      fps: number | null;
      videoCodec: string | null;
      audioCodec: string | null;
      reconnects: number;
      recorderRunning: boolean;
      recorderVersion: string | null;
      pendingUploads: number;
      lastHeartbeatAt: string | null;
    } | null;
  };
  recordingIndicator: RecordingIndicator;
  /** The recording of the current or most recent broadcast. */
  recording: StaffRecording | null;
  /** A player URL for the dashboard preview of that recording, when it has one. */
  recordingPreviewUrl: string | null;
  readiness: {
    appReady: boolean;
    recorderSeen: boolean;
  };
};

/** One nudge per church per window: the status poll runs every five seconds. */
const lastNudge = new Map<string, number>();
const NUDGE_EVERY_MS = 15_000;

/** A broadcast that ended within this window keeps the post-live screen. */
const POST_LIVE_WINDOW_MS = 12 * 60 * 60_000;

export async function getBroadcastOverview(
  churchId: string,
  options: { client?: SupabaseClient; now?: number; includePreview?: boolean } = {},
): Promise<BroadcastOverview> {
  const db = options.client ?? createAdminClient();
  const now = options.now ?? Date.now();
  const deps = productionLifecycleDeps(db);

  const [session, previewActive, ingest] = await Promise.all([
    getActiveStreamSession(churchId, db),
    isPreviewIngestActive(churchId, db),
    deps.repo.getIngestStatus(churchId),
  ]);

  const ingestFresh =
    ingest !== null && now - Date.parse(ingest.heartbeatAt) <= RELAY_HEARTBEAT_TTL_MS && ingest.publishing;
  const videoArriving = previewActive || ingestFresh;

  // The broadcast to talk about: the one on air, or the one that just ended.
  let sessionForRecording: { id: string; createdAt: string; endedAt: string | null } | null = session
    ? { id: session.id, createdAt: session.createdAt, endedAt: session.endedAt }
    : null;
  let endedSession: StreamSession | null = null;
  if (!session) {
    const { data } = await db
      .from("stream_sessions")
      .select("id, church_id, status, title, created_at, ended_at, live_started_at, ingest_started_at, stream_event_id")
      .eq("church_id", churchId)
      .in("status", ["ended", "error"])
      .gte("ended_at", new Date(now - POST_LIVE_WINDOW_MS).toISOString())
      .order("ended_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (data) {
      endedSession = {
        id: data.id as string,
        churchId,
        status: data.status as StreamSession["status"],
        title: (data.title as string | null) ?? null,
        startedBy: null,
        encoderDeviceId: null,
        streamEventId: (data.stream_event_id as string | null) ?? null,
        destinationsSnapshot: [],
        errorMessage: null,
        ingestStartedAt: (data.ingest_started_at as string | null) ?? null,
        liveStartedAt: (data.live_started_at as string | null) ?? null,
        endedAt: (data.ended_at as string | null) ?? null,
        createdAt: data.created_at as string,
        updatedAt: data.created_at as string,
      };
      sessionForRecording = { id: endedSession.id, createdAt: endedSession.createdAt, endedAt: endedSession.endedAt };
    }
  }

  let recording = sessionForRecording
    ? await getStaffRecordingForSession(churchId, sessionForRecording.id, db)
    : null;

  // Nudge this church's own recording forward while someone is watching the
  // screen, so "Preparing" turns into "Ready" without waiting for the cron.
  if (recording && (recording.status === "recording" || recording.status === "processing")) {
    const last = lastNudge.get(churchId) ?? 0;
    if (now - last >= NUDGE_EVERY_MS) {
      lastNudge.set(churchId, now);
      const row = await deps.repo.getRecording(churchId, recording.id);
      if (row) {
        await advanceRecording(deps, row).catch(() => null);
        recording = await getStaffRecording(churchId, recording.id, db);
      }
    }
  }

  // A post-live screen only for a broadcast whose recording still needs the
  // church, or that just finished: once published and a day old it is history.
  const phase: BroadcastPhase = session
    ? session.status === "live"
      ? "live"
      : "waiting_for_video"
    : endedSession && recording
      ? "post_live"
      : "idle";

  const videoSince = session?.ingestStartedAt ?? session?.liveStartedAt ?? null;
  const recordingIndicator = liveRecordingIndicator({
    broadcastActive: Boolean(session),
    videoArriving,
    videoSince,
    lastSegmentAt: recording && recording.status === "recording" ? await lastSegmentAt(db, recording.id) : null,
    relay: ingest
      ? {
          heartbeatAt: ingest.heartbeatAt,
          recorderRunning: ingest.recorderRunning,
          lastSegmentClosedAt: ingest.lastSegmentClosedAt,
        }
      : null,
    now,
  });

  let recordingPreviewUrl: string | null = null;
  if (
    options.includePreview &&
    recording &&
    recording.sourceKind === "segments" &&
    recording.status === "ready" &&
    recordingPlaybackConfigured()
  ) {
    const token = signRecordingPlaybackToken({ churchId, recordingId: recording.id, audience: "staff" });
    if (token) recordingPreviewUrl = recordingPlaylistPath(recording.id, token);
  }

  return {
    phase,
    session: session
      ? {
          id: session.id,
          title: session.title,
          status: session.status,
          startedAt: session.createdAt,
          liveSince: session.liveStartedAt,
          endedAt: session.endedAt,
        }
      : endedSession
        ? {
            id: endedSession.id,
            title: endedSession.title,
            status: endedSession.status,
            startedAt: endedSession.createdAt,
            liveSince: endedSession.liveStartedAt,
            endedAt: endedSession.endedAt,
          }
        : null,
    video: {
      arriving: videoArriving,
      health: ingest
        ? describeStreamHealth(
            {
              publishing: ingest.publishing || previewActive,
              heartbeatAt: ingest.heartbeatAt,
              bitrateKbps: ingest.bitrateKbps,
              width: ingest.width,
              height: ingest.height,
              fps: ingest.fps,
              videoCodec: ingest.videoCodec,
              audioCodec: ingest.audioCodec,
              reconnects: ingest.reconnects,
            },
            now,
          )
        : previewActive
          ? [{ tone: "good", message: "Receiving video." }]
          : describeStreamHealth(null, now),
      stats: ingest
        ? {
            bitrateKbps: ingest.bitrateKbps,
            resolution: ingest.width && ingest.height ? `${ingest.width}×${ingest.height}` : null,
            fps: ingest.fps,
            videoCodec: ingest.videoCodec,
            audioCodec: ingest.audioCodec,
            reconnects: ingest.reconnects,
            recorderRunning: ingest.recorderRunning,
            recorderVersion: ingest.recorderVersion,
            pendingUploads: ingest.pendingUploads,
            lastHeartbeatAt: ingest.heartbeatAt,
          }
        : null,
    },
    recordingIndicator,
    recording,
    recordingPreviewUrl,
    readiness: {
      appReady: mediaPlaybackConfigured(),
      recorderSeen: Boolean(ingest?.recorderVersion),
    },
  };
}

async function lastSegmentAt(db: SupabaseClient, recordingId: string): Promise<string | null> {
  const { data } = await db
    .from("stream_recordings")
    .select("last_segment_at")
    .eq("id", recordingId)
    .maybeSingle();
  return (data?.last_segment_at as string | null) ?? null;
}
