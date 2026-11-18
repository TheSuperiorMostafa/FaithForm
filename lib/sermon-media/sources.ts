import type { SupabaseClient } from "@supabase/supabase-js";

import { buildTimeline, sliceTimeline, type RecordingTimeline, type TimelineSegment } from "@/lib/sermon-media/timeline";
import { MEDIA_BUCKET } from "@/lib/stream/recording-lifecycle";
import { createSupabaseRecordingRepo, type SegmentRecord } from "@/lib/stream/recording-repo";

/**
 * Resolves a recording's private media for one job at execution time, so a job
 * that waited in the queue never holds an expired link. URLs are signed for the
 * job's working window only and are never logged or stored.
 */
const SIGNED_URL_TTL_SECONDS = 2 * 60 * 60;

type Seg = SegmentRecord & TimelineSegment;

export type WorkerSources =
  | {
      kind: "segments";
      timeline_duration_sec: number;
      expires_at: string;
      runs: Array<{
        index: number;
        timeline_start_sec: number;
        duration_sec: number;
        init_url: string;
        segments: Array<{ seq: number; timeline_start_sec: number; duration_sec: number; url: string }>;
      }>;
      gaps: Array<{ timeline_sec: number; reason: string }>;
    }
  | {
      kind: "file";
      timeline_duration_sec: number | null;
      expires_at: string;
      file: { url: string; timeline_start_sec: 0 };
      runs: [];
      gaps: [];
    };

export async function loadRecordingTimeline(
  db: SupabaseClient,
  recordingId: string,
): Promise<RecordingTimeline<Seg>> {
  const repo = createSupabaseRecordingRepo(db);
  const segments = (await repo.listSegments(recordingId)).filter((segment) => segment.status === "uploaded");
  return buildTimeline(segments as Seg[]);
}

async function signMany(db: SupabaseClient, paths: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (let index = 0; index < paths.length; index += 500) {
    const chunk = paths.slice(index, index + 500);
    const { data, error } = await db.storage.from(MEDIA_BUCKET).createSignedUrls(chunk, SIGNED_URL_TTL_SECONDS);
    if (error) throw new Error("Could not sign recording media.");
    for (const item of data ?? []) {
      if (item.path && item.signedUrl) out.set(item.path, item.signedUrl);
    }
  }
  return out;
}

export async function resolveWorkerSources(
  db: SupabaseClient,
  recording: { id: string; sourceKind: "file" | "segments"; storagePath: string; durationSec: number | null },
  window?: { startSec: number; endSec: number },
): Promise<WorkerSources> {
  const expiresAt = new Date(Date.now() + SIGNED_URL_TTL_SECONDS * 1000).toISOString();
  if (recording.sourceKind === "file") {
    const signed = await signMany(db, [recording.storagePath]);
    const url = signed.get(recording.storagePath);
    if (!url) throw new Error("The recording file is missing.");
    return {
      kind: "file",
      timeline_duration_sec: recording.durationSec,
      expires_at: expiresAt,
      file: { url, timeline_start_sec: 0 },
      runs: [],
      gaps: [],
    };
  }

  const full = await loadRecordingTimeline(db, recording.id);
  const timeline = window ? sliceTimeline(full, window.startSec, window.endSec) : full;
  const repo = createSupabaseRecordingRepo(db);
  const takes = await repo.listTakesByIds([...new Set(timeline.runs.map((run) => run.takeId))]);
  const initPath = new Map(takes.map((take) => [take.id, take.initStoragePath]));
  const paths = [
    ...timeline.runs.map((run) => initPath.get(run.takeId)).filter((p): p is string => Boolean(p)),
    ...timeline.runs.flatMap((run) => run.segments.map((segment) => segment.storagePath)),
  ];
  const signed = await signMany(db, paths);

  return {
    kind: "segments",
    timeline_duration_sec: full.durationSec,
    expires_at: expiresAt,
    runs: timeline.runs.flatMap((run) => {
      const init = initPath.get(run.takeId);
      const initUrl = init ? signed.get(init) : undefined;
      // A take without its init cannot be decoded; its time is reported as a
      // gap by the worker rather than shifting what follows.
      return [
        {
          index: run.index,
          timeline_start_sec: run.timelineStartSec,
          duration_sec: run.durationSec,
          init_url: initUrl ?? "",
          segments: run.segments.map((segment) => ({
            seq: segment.seq,
            timeline_start_sec: segment.timelineStartSec,
            duration_sec: segment.durationSec,
            url: signed.get(segment.storagePath) ?? "",
          })),
        },
      ];
    }),
    gaps: timeline.gaps.map((gap) => ({ timeline_sec: gap.timelineSec, reason: gap.reason })),
  };
}
