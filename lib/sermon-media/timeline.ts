import { orderSegments, type PlaylistSegment } from "@/lib/stream/recording-model";

/**
 * The recording's own playback timeline, split into the runs a worker can
 * decode independently.
 *
 * Mirrors `buildVodPlaylist` exactly: segments in playback order; a new run at
 * every take change and every sequence gap (where the player inserts
 * EXT-X-DISCONTINUITY). Reconnect gaps are not on the timeline, so each run
 * starts where the previous one ended. Transcript, range and clip times all use
 * this timeline, which is what the staff `full.m3u8` player shows.
 */
export type TimelineSegment = PlaylistSegment & { storagePath: string };

export type TimelineRun<T extends TimelineSegment = TimelineSegment> = {
  index: number;
  takeId: string;
  timelineStartSec: number;
  durationSec: number;
  segments: Array<T & { timelineStartSec: number }>;
};

export type TimelineGap = { timelineSec: number; reason: "discontinuity" | "missing_segment" };

export type RecordingTimeline<T extends TimelineSegment = TimelineSegment> = {
  durationSec: number;
  runs: TimelineRun<T>[];
  gaps: TimelineGap[];
};

const round3 = (value: number) => Math.round(value * 1000) / 1000;

export function buildTimeline<T extends TimelineSegment>(segments: T[]): RecordingTimeline<T> {
  const ordered = orderSegments(segments);
  const runs: TimelineRun<T>[] = [];
  const gaps: TimelineGap[] = [];
  let position = 0;
  let previous: T | null = null;
  for (const segment of ordered) {
    const newTake = !previous || previous.takeId !== segment.takeId;
    const seqGap = Boolean(previous && !newTake && segment.seq !== previous.seq + 1);
    if (!previous || newTake || seqGap) {
      if (previous) gaps.push({ timelineSec: round3(position), reason: seqGap ? "missing_segment" : "discontinuity" });
      runs.push({ index: runs.length, takeId: segment.takeId, timelineStartSec: round3(position), durationSec: 0, segments: [] });
    }
    const run = runs[runs.length - 1];
    run.segments.push({ ...segment, timelineStartSec: round3(position) });
    position += segment.durationSec;
    run.durationSec = round3(position - run.timelineStartSec);
    previous = segment;
  }
  return { durationSec: round3(position), runs, gaps };
}

/** Only the runs (and segments) that overlap [startSec, endSec), for clip renders. */
export function sliceTimeline<T extends TimelineSegment>(
  timeline: RecordingTimeline<T>,
  startSec: number,
  endSec: number,
): RecordingTimeline<T> {
  const runs: TimelineRun<T>[] = [];
  for (const run of timeline.runs) {
    const segments = run.segments.filter(
      (segment) => segment.timelineStartSec < endSec && segment.timelineStartSec + segment.durationSec > startSec,
    );
    if (segments.length === 0) continue;
    const first = segments[0].timelineStartSec;
    const last = segments[segments.length - 1];
    runs.push({
      index: run.index,
      takeId: run.takeId,
      timelineStartSec: first,
      durationSec: round3(last.timelineStartSec + last.durationSec - first),
      segments,
    });
  }
  return {
    durationSec: timeline.durationSec,
    runs,
    gaps: timeline.gaps.filter((gap) => gap.timelineSec > startSec && gap.timelineSec < endSec),
  };
}

/** Trimmed-player time (index.m3u8) → full timeline, for a church that trimmed its recording. */
export function fullTimelineSec(trimmedSec: number, snappedTrimStartSec: number): number {
  return round3(trimmedSec + snappedTrimStartSec);
}
