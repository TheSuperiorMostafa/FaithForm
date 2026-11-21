import assert from "node:assert/strict";
import test from "node:test";

import type { SupabaseClient } from "@supabase/supabase-js";

import {
  CLIP_REQUEST_LOOKBACK_MS,
  clipRequestsActive,
  describeClipRequests,
  NO_MOMENTS_MESSAGE,
  PIPELINE_FAILED,
  PIPELINE_SKIPPED,
  type ClipRequestInput,
  type ClipRequestJob,
} from "@/lib/sermon-media/clip-requests";
import { suggestClips } from "@/lib/sermon-media/clip-suggest";
import { refreshSuggestedClips } from "@/lib/sermon-media/clips";
import type { SermonMediaState } from "@/lib/sermon-media/store";
import type { Transcript, TranscriptSegment } from "@/lib/sermon-media/transcript";

// Regression: "Make clips" reported success but nothing reached Ready to review,
// and the Clips page said "No clips waiting" while clips were on their way or
// after they had failed.

const SENTENCES = [
  "Have you ever wondered whether God still hears you when you pray in the dark?",
  "I remember when I was nineteen and my father lost his job and we had nothing left.",
  "My mother would sit at the kitchen table every night and pray with tears in her eyes.",
  "She taught me that grace is not something you earn but something you receive with open hands.",
  "If you are carrying that kind of fear this week, here's what I want you to remember today.",
  "You can bring every broken piece to Him and He will not turn you away from His love.",
];

/** A sermon of one-sentence segments, ~2.6 words a second, each with word timing. */
function sermon(start: number, repeats: number, flags: TranscriptSegment["flags"] = []): TranscriptSegment[] {
  const out: TranscriptSegment[] = [];
  let t = start;
  for (let r = 0; r < repeats; r += 1) {
    for (const text of SENTENCES) {
      const tokens = text.split(" ");
      const per = 0.38;
      const words = tokens.map((w, i) => ({ w, s: t + i * per, e: t + i * per + per - 0.04 }));
      out.push({ id: `s${String(out.length + 1).padStart(6, "0")}`, start: t, end: words.at(-1)!.e, text, words, flags: [...flags] } as TranscriptSegment);
      t = words.at(-1)!.e + 0.5;
    }
  }
  return out;
}

test("strict suggestions skip low-confidence words; a person's Make clips falls back to a relaxed pass", () => {
  const segments = sermon(0, 6, ["uncertain"]);
  const end = segments.at(-1)!.end;
  const base = { segments, gaps: [], audioEvents: [], rangeStartSec: 0, rangeEndSec: end };
  assert.equal(suggestClips(base).length, 0, "strict: nothing when every line is low confidence");
  const relaxed = suggestClips({ ...base, mode: "relaxed" });
  assert.ok(relaxed.length >= 1, "relaxed: the moments are still found");
  assert.ok(relaxed.every((clip) => clip.signals.unclear_words < 0), "and carry the penalty");
});

test("relaxed allows speech over quiet music but never noise or slow, sung passages", () => {
  const spoken = sermon(0, 6, ["music"]);
  const end = spoken.at(-1)!.end;
  const base = { gaps: [], audioEvents: [], rangeStartSec: 0, rangeEndSec: end };
  assert.equal(suggestClips({ ...base, segments: spoken }).length, 0);
  assert.ok(suggestClips({ ...base, segments: spoken, mode: "relaxed" }).length >= 1);
  assert.equal(suggestClips({ ...base, segments: sermon(0, 6, ["noise"]), mode: "relaxed" }).length, 0);
  // The same words stretched to one a second: singing, not preaching.
  const sung = spoken.map((segment) => ({
    ...segment,
    start: segment.start * 2.6,
    end: segment.end * 2.6,
    words: segment.words!.map((word) => ({ ...word, s: word.s * 2.6, e: word.e * 2.6 })),
  }));
  assert.equal(suggestClips({ ...base, rangeEndSec: end * 2.6, segments: sung, mode: "relaxed" }).length, 0);
});

/** Just enough of the Supabase query builder for refreshSuggestedClips. */
function fakeDb(existing: Array<{ start_sec: number; end_sec: number }>) {
  const inserted: Array<Record<string, unknown>> = [];
  const db = {
    from(table: string) {
      const q = { op: "select" as "select" | "update" | "insert", payload: null as unknown };
      const chain = {
        select: () => chain,
        update: (payload: unknown) => Object.assign(q, { op: "update", payload }) && chain,
        insert: (payload: unknown) => Object.assign(q, { op: "insert", payload }) && chain,
        eq: () => chain,
        neq: () => chain,
        then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) {
          assert.equal(table, "sermon_clips");
          if (q.op === "insert") inserted.push(...(q.payload as Array<Record<string, unknown>>));
          return Promise.resolve({ data: q.op === "select" ? existing : null, error: null }).then(resolve, reject);
        },
      };
      return chain;
    },
  };
  return { db: db as unknown as SupabaseClient, inserted };
}

function transcriptOf(segments: TranscriptSegment[]): Transcript {
  return { version: 1, kind: "machine", language: "en", engine: "test", durationSec: segments.at(-1)!.end, segments, gaps: [], audioEvents: [], createdAt: "" } as Transcript;
}

const stateFor = (end: number): SermonMediaState => ({
  recordingId: "rec",
  currentTranscriptVersion: 1,
  suggestion: { status: "suggested", startSec: 0, endSec: end, confidence: 1, evidence: [], forVersion: 1 },
  confirmed: { startSec: 0, endSec: end, by: null, at: "", transcriptVersion: 1, automatic: true },
  inputVersion: 1,
});

test("Make clips again never makes a clip the church already has", async () => {
  const segments = sermon(0, 6);
  const transcript = transcriptOf(segments);
  const state = stateFor(segments.at(-1)!.end);
  const first = fakeDb([]);
  const count = await refreshSuggestedClips(first.db, "church", "rec", state, transcript);
  assert.ok(count >= 1);
  const kept = first.inserted.map((row) => ({ start_sec: Number(row.start_sec), end_sec: Number(row.end_sec) }));
  const second = fakeDb(kept);
  await refreshSuggestedClips(second.db, "church", "rec", state, transcript, { relaxedFallback: true });
  for (const row of second.inserted) {
    const s = Number(row.start_sec);
    const e = Number(row.end_sec);
    for (const old of kept) {
      const shared = Math.min(e, old.end_sec) - Math.max(s, old.start_sec);
      assert.ok(shared <= 0.5 * Math.min(e - s, old.end_sec - old.start_sec), `duplicate of ${old.start_sec}`);
    }
  }
});

test("a person's Make clips uses the relaxed pass when the strict one finds nothing", async () => {
  const segments = sermon(0, 6, ["uncertain"]);
  const transcript = transcriptOf(segments);
  const state = stateFor(segments.at(-1)!.end);
  assert.equal(await refreshSuggestedClips(fakeDb([]).db, "church", "rec", state, transcript), 0, "automatic run stays strict");
  assert.ok((await refreshSuggestedClips(fakeDb([]).db, "church", "rec", state, transcript, { relaxedFallback: true })) >= 1);
});

// ---------------------------------------------------------------------------
// What the Clips page says about each request.

const NOW = Date.parse("2026-11-21T15:00:00Z");
const minutesAgo = (m: number) => new Date(NOW - m * 60_000).toISOString();

function job(over: Partial<ClipRequestJob> = {}): ClipRequestJob {
  return {
    recording_id: "rec1",
    kind: "transcribe",
    status: "running",
    stage: "asr",
    progress: 0.4,
    created_at: minutesAgo(3),
    dispatched_at: minutesAgo(3),
    started_at: minutesAgo(2),
    finished_at: null,
    updated_at: minutesAgo(1),
    last_error_code: null,
    ...over,
  };
}

function input(over: Partial<ClipRequestInput> = {}): ClipRequestInput {
  return {
    jobs: [job()],
    recordings: new Map([["rec1", { title: "Sunday Service", durationSec: 5400, deleted: false }]]),
    states: new Map(),
    clipCounts: new Map(),
    now: NOW,
    ...over,
  };
}

test("a request still being written out shows progress, not 'No clips waiting'", () => {
  const [request] = describeClipRequests(input());
  assert.equal(request.state, "transcribing");
  assert.equal(request.label, "Writing out the service");
  assert.equal(request.progress?.state, "working");
  assert.equal(clipRequestsActive([request]), true);
  const [slow] = describeClipRequests(input({ jobs: [job({ status: "queued", started_at: null, dispatched_at: null, created_at: minutesAgo(40) })] }));
  assert.equal(slow.label, "Still waiting to start");
});

test("a transcript that failed says so and offers Try again", () => {
  const [request] = describeClipRequests(input({ jobs: [job({ status: "failed", finished_at: minutesAgo(5), last_error_code: "dispatch_failed" })] }));
  assert.equal(request.state, "failed");
  assert.equal(request.canRetry, true);
  assert.match(request.detail, /couldn't start writing out Sunday Service, so no clips were made/);
  assert.doesNotMatch(request.detail, /dispatch|worker|lease/i, "no internals");
  assert.equal(clipRequestsActive([request]), false);
});

test("after the transcript: finding moments, failed, nothing found, or done", () => {
  const done = job({ status: "succeeded", finished_at: minutesAgo(2) });
  const at = (pipelineVersion: number | null, clips = 0) =>
    describeClipRequests(input({
      jobs: [done],
      states: new Map([["rec1", { transcriptVersion: 1, pipelineVersion }]]),
      clipCounts: new Map([["rec1", clips]]),
    }));
  assert.equal(at(null)[0].state, "finding");
  assert.equal(at(PIPELINE_FAILED)[0].state, "failed");
  assert.equal(at(PIPELINE_FAILED)[0].canRetry, true);
  assert.equal(at(1)[0].state, "no_moments");
  assert.equal(at(1)[0].detail, NO_MOMENTS_MESSAGE);
  assert.deepEqual(at(1, 3), [], "its clips are in Ready to review");
  assert.deepEqual(at(PIPELINE_SKIPPED), []);
});

test("only the newest request per recording, nothing for deleted recordings or old outcomes", () => {
  const newer = job({ status: "running" });
  const older = job({ status: "failed", created_at: minutesAgo(60), finished_at: minutesAgo(50) });
  assert.equal(describeClipRequests(input({ jobs: [newer, older] })).length, 1);
  assert.deepEqual(describeClipRequests(input({ recordings: new Map([["rec1", { title: "x", durationSec: 1, deleted: true }]]) })), []);
  const stale = job({ status: "failed", finished_at: new Date(NOW - CLIP_REQUEST_LOOKBACK_MS - 60_000).toISOString() });
  assert.deepEqual(describeClipRequests(input({ jobs: [stale] })), []);
});
