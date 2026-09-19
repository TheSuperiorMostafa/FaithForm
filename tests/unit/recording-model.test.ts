import assert from "node:assert/strict";
import test from "node:test";

import {
  buildVodPlaylist,
  defaultRecordingTitle,
  describeStreamHealth,
  finalizeDecision,
  frameStoragePath,
  initStoragePath,
  pickSessionForSegment,
  recordingCompleteness,
  recordingPhase,
  segmentStoragePath,
  segmentsInTrim,
  snapTrim,
  takeAccountedFor,
  type PlaylistSegment,
  type RecordingRowState,
  type SessionWindow,
} from "@/lib/stream/recording-model";

const CHURCH = "11111111-2222-3333-4444-555555555555";
const RECORDING = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const TAKE = "99999999-8888-7777-6666-555555555555";

function segments(count: number, takeId = "t1", startIso = "2026-09-20T14:00:00Z", duration = 6): PlaylistSegment[] {
  return Array.from({ length: count }, (_, seq) => ({
    id: `${takeId}-${seq}`,
    takeId,
    seq,
    startedAt: new Date(Date.parse(startIso) + seq * duration * 1000).toISOString(),
    durationSec: duration,
  }));
}

function session(partial: Partial<SessionWindow>): SessionWindow {
  return {
    id: "s",
    churchId: CHURCH,
    streamEventId: null,
    title: null,
    createdAt: "2026-09-20T14:00:00Z",
    endedAt: null,
    status: "live",
    ...partial,
  };
}

test("a segment belongs to the broadcast whose window contains it", () => {
  const sunday = session({ id: "sunday", createdAt: "2026-09-20T14:00:00Z", endedAt: "2026-09-20T15:00:00Z" });
  const inside = { startedAt: "2026-09-20T14:30:00Z", durationSec: 6 };
  const before = { startedAt: "2026-09-20T13:59:00Z", durationSec: 6 };
  const after = { startedAt: "2026-09-20T15:00:00Z", durationSec: 6 };
  assert.equal(pickSessionForSegment(inside, [sunday])?.id, "sunday");
  assert.equal(pickSessionForSegment(before, [sunday]), null, "preview before Go Live");
  assert.equal(pickSessionForSegment(after, [sunday]), null, "the encoder left running after End");
  // A segment in progress when Go Live was pressed is part of the service.
  const straddling = { startedAt: "2026-09-20T13:59:57Z", durationSec: 6 };
  assert.equal(pickSessionForSegment(straddling, [sunday])?.id, "sunday");
});

test("a segment straddling two broadcasts goes to the one it overlaps most", () => {
  const first = session({ id: "first", createdAt: "2026-09-20T14:00:00Z", endedAt: "2026-09-20T14:30:02Z" });
  const second = session({ id: "second", createdAt: "2026-09-20T14:30:02Z" });
  const segment = { startedAt: "2026-09-20T14:30:00Z", durationSec: 6 };
  assert.equal(pickSessionForSegment(segment, [first, second])?.id, "second");
});

test("a take is accounted for when closed and fully seen, or once it has passed the end", () => {
  const base = { id: "t", startedAt: "2026-09-20T14:00:00Z", endedAt: null, lastSeq: null, highestSeenSeq: 10, highestSeenStart: "2026-09-20T14:01:00Z" };
  assert.equal(takeAccountedFor(base, "2026-09-20T14:05:00Z"), false);
  assert.equal(takeAccountedFor({ ...base, highestSeenStart: "2026-09-20T14:05:01Z" }, "2026-09-20T14:05:00Z"), true);
  assert.equal(takeAccountedFor({ ...base, endedAt: "2026-09-20T14:02:00Z", lastSeq: 12 }, "2026-09-20T14:05:00Z"), false);
  assert.equal(takeAccountedFor({ ...base, endedAt: "2026-09-20T14:02:00Z", lastSeq: 10 }, "2026-09-20T14:05:00Z"), true);
});

test("completeness waits for uploads before anything else", () => {
  const window = { from: "2026-09-20T14:00:00Z", to: "2026-09-20T15:00:00Z" };
  assert.deepEqual(
    recordingCompleteness({ window, takes: [], pendingSegments: 1, pendingInits: 0 }),
    { complete: false, waitingFor: "uploads" },
  );
  assert.deepEqual(recordingCompleteness({ window, takes: [], pendingSegments: 0, pendingInits: 0 }), { complete: true });
});

test("finalize waits, then times out, and never waits forever", () => {
  const ended = "2026-09-20T15:00:00Z";
  const at = (minutes: number) => Date.parse(ended) + minutes * 60_000;
  const incomplete = { complete: false as const, waitingFor: "relay" as const };
  assert.equal(finalizeDecision({ broadcastEndedAt: ended, lastActivityAt: ended, segmentCount: 5, completeness: incomplete, now: at(2) }), "wait");
  assert.equal(finalizeDecision({ broadcastEndedAt: ended, lastActivityAt: ended, segmentCount: 5, completeness: incomplete, now: at(11) }), "timeout");
  assert.equal(
    finalizeDecision({ broadcastEndedAt: ended, lastActivityAt: new Date(at(9)).toISOString(), segmentCount: 5, completeness: incomplete, now: at(11) }),
    "wait",
    "the relay is still catching up",
  );
  assert.equal(finalizeDecision({ broadcastEndedAt: ended, lastActivityAt: ended, segmentCount: 5, completeness: incomplete, now: at(31) }), "timeout");
  assert.equal(finalizeDecision({ broadcastEndedAt: ended, lastActivityAt: null, segmentCount: 0, completeness: incomplete, now: at(6) }), "empty");
  assert.equal(finalizeDecision({ broadcastEndedAt: ended, lastActivityAt: null, segmentCount: 3, completeness: { complete: true }, now: at(0) }), "finalize");
});

test("trim snaps outward to segment boundaries and never drops what was asked for", () => {
  const list = segments(20); // 120s
  assert.deepEqual(snapTrim(list, 13, 50), { startSec: 12, endSec: 54, durationSec: 42 });
  assert.deepEqual(snapTrim(list, 0, null), { startSec: 0, endSec: null, durationSec: 120 });
  assert.deepEqual(snapTrim(list, 0, 500), { startSec: 0, endSec: null, durationSec: 120 });
  assert.deepEqual(snapTrim(list, 999, null), { startSec: 114, endSec: null, durationSec: 6 });

  const kept = segmentsInTrim(list, 12, 54);
  assert.equal(kept[0].seq, 2);
  assert.equal(kept.at(-1)?.seq, 8);
});

test("the VOD playlist is VOD, starts each take with its init, and marks every discontinuity", () => {
  const first = segments(3, "a");
  const gap = segments(5, "a").slice(4); // seq 4 after seq 2: a lost segment
  const second = segments(2, "b", "2026-09-20T14:01:00Z");
  const playlist = buildVodPlaylist({
    segments: [...second, ...gap, ...first],
    trimStartSec: 0,
    trimEndSec: null,
    initUri: (take) => `init/${take}.mp4`,
    segmentUri: (segment) => `seg/${segment.id}.m4s`,
  });
  const lines = playlist.trim().split("\n");
  assert.equal(lines[0], "#EXTM3U");
  assert.ok(lines.includes("#EXT-X-PLAYLIST-TYPE:VOD"));
  assert.equal(lines.at(-1), "#EXT-X-ENDLIST");
  assert.equal(lines.filter((line) => line.startsWith("#EXT-X-MAP")).length, 2);
  assert.equal(lines.filter((line) => line === "#EXT-X-DISCONTINUITY").length, 2);
  assert.ok(lines.indexOf("seg/a-0.m4s") < lines.indexOf("seg/b-0.m4s"));
  assert.ok(lines.includes("#EXTINF:6.000,"));
  assert.ok(lines.includes("#EXT-X-TARGETDURATION:6"));
});

test("storage paths are derived from FaithForm's ids and refuse anything else", () => {
  assert.equal(segmentStoragePath(CHURCH, RECORDING, TAKE, 7), `rec/${CHURCH}/${RECORDING}/${TAKE}/000007.m4s`);
  assert.equal(initStoragePath(CHURCH, TAKE), `rec/${CHURCH}/takes/${TAKE}/init.mp4`);
  assert.match(frameStoragePath(CHURCH, RECORDING, TAKE, 3, "abc123"), /^recording-frames\/.+-3-abc123\.jpg$/);
  assert.throws(() => segmentStoragePath("../other", RECORDING, TAKE, 1));
  assert.throws(() => segmentStoragePath(CHURCH, RECORDING, TAKE, -1));
  assert.throws(() => frameStoragePath(CHURCH, RECORDING, TAKE, 1, "../x"));
});

test("a recording is named after its service and the church's own date", () => {
  assert.equal(defaultRecordingTitle("Sunday Worship", "2026-09-20T15:00:00Z", "America/New_York"), "Sunday Worship – September 20");
  // 11:30pm Saturday in Los Angeles is Sunday in UTC; it is still Saturday's service.
  assert.equal(defaultRecordingTitle("Vigil", "2026-09-20T06:30:00Z", "America/Los_Angeles"), "Vigil – September 19");
  assert.equal(defaultRecordingTitle("", "2026-09-20T15:00:00Z", "UTC"), "Service – September 20");
  assert.equal(defaultRecordingTitle("Service – September 20", "2026-09-20T15:00:00Z", "UTC"), "Service – September 20");
});

test("every state reads as plain language, never as a status code", () => {
  const base: RecordingRowState = {
    status: "ready",
    sourceKind: "segments",
    mobilePlayable: true,
    renditionReason: "ok",
    renditionVerifiedAt: "2026-09-20T15:00:00Z",
    mobileVisibility: "none",
    mobilePublishedAt: null,
    mobileUnpublishedAt: null,
    webPublishedAt: null,
    webUnpublishedAt: null,
    failureReason: null,
    deletedAt: null,
  };
  const cases: Array<[Partial<RecordingRowState>, string]> = [
    [{ status: "recording" }, "Live"],
    [{ status: "processing" }, "Preparing recording"],
    [{}, "Ready to publish"],
    [{ mobileVisibility: "public", mobilePublishedAt: "x" }, "Published"],
    [{ webPublishedAt: "x" }, "Published"],
    [{ mobileVisibility: "public", mobilePublishedAt: "x", mobileUnpublishedAt: "y" }, "Not published"],
    [{ status: "failed", failureReason: "nothing_recorded" }, "Needs attention"],
    [{ mobilePlayable: false, renditionReason: "video_codec_unsupported" }, "Needs attention"],
    [{ mobilePlayable: false, renditionReason: "probe_timeout" }, "Preparing recording"],
    [{ mobilePlayable: false, renditionVerifiedAt: null }, "Preparing recording"],
  ];
  for (const [patch, label] of cases) {
    const view = recordingPhase({ ...base, ...patch });
    assert.equal(view.label, label, JSON.stringify(patch));
    assert.doesNotMatch(`${view.label} ${view.detail ?? ""}`, /asset|manifest|hls|codec|vod|transcod|rtmp|_/i);
  }
});

test("stream health is translated, not dumped", () => {
  const now = Date.parse("2026-09-20T15:00:00Z");
  const fresh = new Date(now - 5_000).toISOString();
  assert.match(describeStreamHealth(null, now)[0].message, /isn't receiving video/);
  assert.match(
    describeStreamHealth({ publishing: false, heartbeatAt: fresh, bitrateKbps: null, width: null, height: null, fps: null, videoCodec: null, audioCodec: null, reconnects: 0 }, now)[0].message,
    /disconnected\. FaithForm is waiting for your encoder to reconnect/,
  );
  const notes = describeStreamHealth(
    { publishing: true, heartbeatAt: fresh, bitrateKbps: 400, width: 1280, height: 720, fps: 30, videoCodec: "h264", audioCodec: null, reconnects: 2 },
    now,
  ).map((note) => note.message);
  assert.ok(notes.some((message) => /upload looks slow/.test(message)));
  assert.ok(notes.some((message) => /No sound/.test(message)));
  assert.ok(notes.some((message) => /dropped 2 times/.test(message)));
});
