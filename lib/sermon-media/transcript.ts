import { z } from "zod";

/**
 * Transcript data on the recording timeline (see timeline.ts).
 *
 * A machine version is what the engine produced and is never rewritten. An
 * edited version keeps every segment's id and machine start/end; a segment
 * whose text changed loses its word timing (the words no longer match), and
 * its `edited` flag is set. The machine version stays available for comparison.
 */

const time = z.number().finite().min(0).max(86_400);

export const transcriptWordSchema = z.object({
  w: z.string().min(1).max(200),
  s: time,
  e: time,
  p: z.number().min(0).max(1).optional(),
});

export const SEGMENT_FLAGS = ["uncertain", "noise", "music", "overlap_merged", "edited"] as const;

export const transcriptSegmentSchema = z.object({
  id: z.string().regex(/^s\d{1,7}$/),
  start: time,
  end: time,
  text: z.string().max(4000),
  words: z.array(transcriptWordSchema).max(4000).optional(),
  conf: z.number().min(0).max(1).optional(),
  flags: z.array(z.enum(SEGMENT_FLAGS)).max(8).optional(),
});

export const transcriptGapSchema = z.object({
  start: time,
  end: time,
  reason: z.enum(["missing_audio", "discontinuity", "silence", "music", "noise"]),
});

export const audioEventSchema = z.object({
  start: time,
  end: time,
  label: z.enum(["applause", "laughter", "music", "crowd", "singing", "cheering"]),
  score: z.number().min(0).max(1),
});

export const workerTranscriptSchema = z.object({
  attempt_id: z.string().uuid(),
  language: z.string().regex(/^[a-z]{2,3}(-[A-Za-z]{2})?$/),
  engine: z.string().min(1).max(80),
  duration_sec: time,
  segments: z.array(transcriptSegmentSchema).max(20_000),
  gaps: z.array(transcriptGapSchema).max(5_000).default([]),
  audio_events: z.array(audioEventSchema).max(5_000).default([]),
  metrics: z.record(z.string(), z.unknown()).default({}),
});

export type TranscriptWord = z.infer<typeof transcriptWordSchema>;
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>;
export type TranscriptGap = z.infer<typeof transcriptGapSchema>;
export type AudioEvent = z.infer<typeof audioEventSchema>;
export type WorkerTranscript = z.infer<typeof workerTranscriptSchema>;

export type Transcript = {
  version: number;
  kind: "machine" | "edited";
  language: string | null;
  engine: string | null;
  durationSec: number | null;
  segments: TranscriptSegment[];
  gaps: TranscriptGap[];
  audioEvents: AudioEvent[];
  createdAt: string;
};

/**
 * Structural checks the schema cannot express: ordered, non-overlapping, within
 * the recording, words inside their segment. Returns a list of problems.
 */
export function checkTranscript(input: WorkerTranscript, timelineDurationSec: number): string[] {
  const problems: string[] = [];
  const limit = timelineDurationSec + 1;
  let previousEnd = 0;
  const ids = new Set<string>();
  for (const segment of input.segments) {
    if (ids.has(segment.id)) problems.push(`duplicate segment ${segment.id}`);
    ids.add(segment.id);
    if (segment.end <= segment.start) problems.push(`${segment.id} ends before it starts`);
    if (segment.start < previousEnd - 0.01) problems.push(`${segment.id} overlaps the previous segment`);
    if (segment.end > limit) problems.push(`${segment.id} runs past the end of the recording`);
    for (const word of segment.words ?? []) {
      if (word.s < segment.start - 0.05 || word.e > segment.end + 0.05 || word.e < word.s) {
        problems.push(`${segment.id} has a word outside its time`);
        break;
      }
    }
    previousEnd = Math.max(previousEnd, segment.end);
    if (problems.length > 20) break;
  }
  return problems;
}

export type SegmentEdit = { id: string; text: string };

/**
 * Applies staff text corrections to a version. Times never move. Returns the
 * new segment list and the span the edits touched (for input versioning), or
 * null when nothing actually changed.
 */
export function applyTranscriptEdits(
  segments: TranscriptSegment[],
  edits: SegmentEdit[],
): { segments: TranscriptSegment[]; touchedStartSec: number; touchedEndSec: number } | null {
  const byId = new Map(edits.map((edit) => [edit.id, normalizeText(edit.text)]));
  let touchedStart = Number.POSITIVE_INFINITY;
  let touchedEnd = 0;
  const next = segments.map((segment) => {
    const replacement = byId.get(segment.id);
    if (replacement === undefined || replacement === segment.text) return segment;
    touchedStart = Math.min(touchedStart, segment.start);
    touchedEnd = Math.max(touchedEnd, segment.end);
    const flags = new Set(segment.flags ?? []);
    flags.add("edited");
    flags.delete("uncertain");
    const rest: TranscriptSegment = { ...segment };
    delete rest.words;
    return { ...rest, text: replacement, flags: [...flags] };
  });
  if (!Number.isFinite(touchedStart)) return null;
  return { segments: next, touchedStartSec: touchedStart, touchedEndSec: touchedEnd };
}

function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 4000);
}

/**
 * The segments inside a range. A segment that straddles a bound is kept only
 * for the words inside it; without word timing it is kept when most of it lies
 * inside. Text outside the confirmed sermon never reaches a lesson or clip.
 */
export function segmentsInRange(
  segments: TranscriptSegment[],
  startSec: number,
  endSec: number,
): TranscriptSegment[] {
  const kept: TranscriptSegment[] = [];
  for (const segment of segments) {
    if (segment.end <= startSec || segment.start >= endSec) continue;
    if (segment.start >= startSec && segment.end <= endSec) {
      kept.push(segment);
      continue;
    }
    if (segment.words && segment.words.length > 0) {
      const words = segment.words.filter((word) => word.s >= startSec - 0.01 && word.e <= endSec + 0.01);
      if (words.length === 0) continue;
      kept.push({
        ...segment,
        start: Math.max(segment.start, words[0].s),
        end: Math.min(segment.end, words[words.length - 1].e),
        text: words.map((word) => word.w).join(" "),
        words,
      });
      continue;
    }
    const inside = Math.min(segment.end, endSec) - Math.max(segment.start, startSec);
    if (inside / (segment.end - segment.start) >= 0.5) kept.push(segment);
  }
  return kept;
}

export function formatTimestamp(totalSec: number): string {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h > 0 ? String(m).padStart(2, "0") : String(m);
  return `${h > 0 ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}

export function wordCount(segments: TranscriptSegment[]): number {
  return segments.reduce((sum, segment) => sum + (segment.text.match(/\S+/g)?.length ?? 0), 0);
}
