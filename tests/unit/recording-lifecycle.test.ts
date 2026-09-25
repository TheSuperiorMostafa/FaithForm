import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  advanceRecording,
  ensureRecordingForSession,
  handleCommit,
  handleHeartbeat,
  handlePrepare,
  handleTakeEvent,
  onBroadcastEnded,
  purgeRecordingMedia,
  reconcileRecordings,
  type LifecycleDeps,
} from "@/lib/stream/recording-lifecycle";
import {
  buildVodPlaylist,
  liveRecordingIndicator,
  recordingPhase,
  type SessionWindow,
} from "@/lib/stream/recording-model";
import type { PrepareDecision } from "@/lib/stream/relay-protocol";
import { FakeClock, FakeRecordingRepo, FakeRecordingStorage } from "@/tests/support/recording-fakes";

const H264_INIT = new Uint8Array(readFileSync("tests/fixtures/recording/init-h264-aac.mp4"));
const HEVC_INIT = new Uint8Array(readFileSync("tests/fixtures/recording/init-hevc-aac.mp4"));

type World = {
  clock: FakeClock;
  repo: FakeRecordingRepo;
  storage: FakeRecordingStorage;
  deps: LifecycleDeps;
  events: string[];
};

function world(): World {
  const clock = new FakeClock();
  const repo = new FakeRecordingRepo(clock);
  const storage = new FakeRecordingStorage();
  const events: string[] = [];
  return {
    clock,
    repo,
    storage,
    events,
    deps: { repo, storage, now: clock.now, log: (event) => events.push(event) },
  };
}

/**
 * The relay's recorder, as the lifecycle sees it: segments close every six
 * seconds, get prepared, uploaded to whatever URL FaithForm hands back, and
 * committed. Every step can be dropped or repeated to model a failure.
 */
class FakeRelay {
  seq = 0;
  takeStart = "";
  takeId = "";
  frameEvery = 0;
  constructor(
    private readonly w: World,
    private readonly churchId: string,
    private readonly init: Uint8Array = H264_INIT,
    private readonly path = `live/${churchId}`,
  ) {}

  async connect(label = Math.random().toString(36).slice(2, 12)) {
    this.takeId = `take_${label}`;
    this.seq = 0;
    this.takeStart = this.w.clock.iso();
    await handleTakeEvent(this.w.deps, this.churchId, {
      path: this.path,
      takeId: this.takeId,
      event: "started",
      at: this.takeStart,
    });
  }

  segmentStart(seq: number) {
    return new Date(Date.parse(this.takeStart) + seq * 6000).toISOString();
  }

  /** Records [count] segments of real time and delivers them. */
  async record(count: number, options: { dropCommit?: boolean; dropUpload?: boolean } = {}) {
    const decisions: PrepareDecision[] = [];
    for (let index = 0; index < count; index += 1) {
      this.w.clock.advance(6000);
      const seq = this.seq++;
      const items: Array<{ kind: "init" | "segment" | "frame"; seq: number; startedAt?: string; durationSec?: number; bytes?: number }> = [
        { kind: "segment", seq, startedAt: this.segmentStart(seq), durationSec: 6, bytes: 1000 + seq },
      ];
      items.unshift({ kind: "init", seq: 0, bytes: this.init.length });
      if (this.frameEvery > 0 && seq % this.frameEvery === 0) {
        items.push({ kind: "frame", seq, startedAt: this.segmentStart(seq), bytes: 500 });
      }
      decisions.push(...(await this.deliver(items, options)));
    }
    return decisions;
  }

  async deliver(
    items: Array<{ kind: "init" | "segment" | "frame"; seq: number; startedAt?: string; durationSec?: number; bytes?: number }>,
    options: { dropCommit?: boolean; dropUpload?: boolean } = {},
  ) {
    const prepared = await handlePrepare(this.w.deps, this.churchId, {
      path: this.path,
      takeId: this.takeId,
      takeStartedAt: this.takeStart,
      items,
    });
    const committed: Array<{ kind: "init" | "segment" | "frame"; seq: number; bytes?: number }> = [];
    for (const decision of prepared.items) {
      if (decision.action === "upload") {
        if (options.dropUpload) continue;
        const bytes =
          decision.kind === "init"
            ? this.init
            : new Uint8Array(items.find((item) => item.kind === decision.kind && item.seq === decision.seq)?.bytes ?? 100);
        this.w.storage.put(decision.uploadUrl, bytes);
        committed.push({ kind: decision.kind, seq: decision.seq, bytes: bytes.length });
      } else if (decision.action === "done") {
        committed.push({ kind: decision.kind, seq: decision.seq });
      }
    }
    if (committed.length > 0 && !options.dropCommit) {
      await handleCommit(this.w.deps, this.churchId, { path: this.path, takeId: this.takeId, items: committed });
    }
    return prepared.items;
  }

  async disconnect(report = true) {
    if (!report) return;
    await handleTakeEvent(this.w.deps, this.churchId, {
      path: this.path,
      takeId: this.takeId,
      event: "ended",
      at: this.w.clock.iso(),
      lastSeq: this.seq > 0 ? this.seq - 1 : null,
    });
  }
}

async function goLive(w: World, churchId: string, eventId: string | null) {
  const session = w.repo.startSession(churchId, eventId);
  const recording = await ensureRecordingForSession(w.deps, session);
  return { session, recording };
}

async function end(w: World, session: SessionWindow) {
  w.repo.endSession(session.id, w.clock.iso());
  return onBroadcastEnded(w.deps, session.churchId, session.id);
}

// ---------------------------------------------------------------------------

test("scenario A: a normal service records, finishes and verifies without anyone pressing Record", async () => {
  const w = world();
  const church = w.repo.addChurch({ timezone: "America/Chicago" });
  const event = w.repo.addEvent(church.id, "Sunday Worship");
  const relay = new FakeRelay(w, church.id);

  // The encoder is on before anyone presses Go Live. That preview is not the service.
  await relay.connect("a1");
  const preview = await relay.record(3);
  assert.ok(preview.filter((d) => d.kind === "segment").every((d) => d.action === "skip"));

  const { session, recording } = await goLive(w, church.id, event.id);
  assert.equal(recording.status, "recording");
  assert.equal(recording.streamEventId, event.id, "the recording is the broadcast's, from the first second");
  assert.equal(recording.streamSessionId, session.id);
  assert.match(recording.title ?? "", /^Sunday Worship – September 20$/);

  await relay.record(10);
  const during = await w.repo.getRecording(church.id, recording.id);
  assert.equal(during?.segmentCount, 10);
  assert.equal(during?.status, "recording");

  const indicator = liveRecordingIndicator({
    broadcastActive: true,
    videoArriving: true,
    videoSince: relay.takeStart,
    lastSegmentAt: during?.lastSegmentAt ?? null,
    relay: null,
    now: w.clock.now(),
  });
  assert.equal(indicator.state, "recording", "confirmed from an acknowledged segment");

  const ended = await end(w, session);
  assert.equal(ended?.status, "processing", "still waiting for the relay to account for the take");
  assert.equal(recordingPhase(toState(ended!)).label, "Processing");

  // Two more segments the encoder sent after End are not part of the service.
  const after = await relay.record(2);
  assert.ok(after.filter((d) => d.kind === "segment").every((d) => d.action === "skip"));
  await relay.disconnect();

  const settled = await w.repo.getRecording(church.id, recording.id);
  assert.equal(settled?.status, "ready");
  assert.equal(settled?.mobilePlayable, true);
  assert.equal(settled?.segmentCount, 10);
  assert.equal(settled?.durationSec, 60);
  assert.equal(recordingPhase(toState(settled!)).label, "Ready to publish");
  assert.ok(w.events.includes("recording_ready"));

  const segments = await w.repo.listSegments(recording.id);
  const playlist = buildVodPlaylist({
    segments,
    trimStartSec: 0,
    trimEndSec: null,
    initUri: (take) => `init/${take}.mp4`,
    segmentUri: (segment) => `seg/${segment.id}.m4s`,
  });
  assert.equal((playlist.match(/#EXTINF/g) ?? []).length, 10);
  assert.match(playlist, /#EXT-X-PLAYLIST-TYPE:VOD/);
  assert.match(playlist, /#EXT-X-ENDLIST/);
});

test("scenario B: closing the dashboard changes nothing — state is rebuilt from the backend", async () => {
  const w = world();
  const church = w.repo.addChurch();
  const relay = new FakeRelay(w, church.id);
  await relay.connect();
  const { session, recording } = await goLive(w, church.id, w.repo.addEvent(church.id).id);

  // No dashboard is involved in any of this: only the relay talks to FaithForm.
  await relay.record(20);

  // "The admin comes back": everything they need is in the recording row.
  const reopened = await w.repo.getRecording(church.id, recording.id);
  assert.equal(reopened?.segmentCount, 20);
  assert.equal(reopened?.status, "recording");

  // The operator ends it from another computer entirely.
  w.repo.endSession(session.id, w.clock.iso());
  await relay.disconnect();
  // onBroadcastEnded was never called (that browser closed); the reconciler repairs it.
  const report = await reconcileRecordings(w.deps);
  assert.equal(report.ready, 1);
  const settled = await w.repo.getRecording(church.id, recording.id);
  assert.equal(settled?.status, "ready");
  assert.ok(w.events.includes("reconciliation_repair"));
});

test("scenario C: an encoder that drops and reconnects is still one recording", async () => {
  const w = world();
  const church = w.repo.addChurch();
  const relay = new FakeRelay(w, church.id);
  const { session, recording } = await goLive(w, church.id, w.repo.addEvent(church.id).id);

  await relay.connect("first");
  await relay.record(5);
  await relay.disconnect();
  w.clock.advance(20_000); // the signal is gone for twenty seconds
  await relay.connect("second");
  await relay.record(5);

  const live = await w.repo.getRecording(church.id, recording.id);
  assert.equal(live?.segmentCount, 10);

  await end(w, session);
  await relay.disconnect();

  const settled = await w.repo.getRecording(church.id, recording.id);
  assert.equal(settled?.status, "ready");
  assert.equal(settled?.mobilePlayable, true);

  const takes = new Set((await w.repo.listSegments(recording.id)).map((segment) => segment.takeId));
  assert.equal(takes.size, 2);
  const playlist = buildVodPlaylist({
    segments: await w.repo.listSegments(recording.id),
    trimStartSec: 0,
    trimEndSec: null,
    initUri: (take) => `init/${take}.mp4`,
    segmentUri: (segment) => `seg/${segment.id}.m4s`,
  });
  assert.equal((playlist.match(/#EXT-X-DISCONTINUITY/g) ?? []).length, 1);
  assert.equal((playlist.match(/#EXT-X-MAP/g) ?? []).length, 2);
});

test("scenario D: a commit that never arrived is found in storage and bound by reconciliation", async () => {
  const w = world();
  const church = w.repo.addChurch();
  const relay = new FakeRelay(w, church.id);
  await relay.connect();
  const { session, recording } = await goLive(w, church.id, w.repo.addEvent(church.id).id);

  await relay.record(4);
  await relay.record(3, { dropCommit: true }); // uploaded, but FaithForm never heard
  await end(w, session);
  await relay.disconnect();

  const stuck = await w.repo.getRecording(church.id, recording.id);
  assert.equal(stuck?.status, "processing", "three segments are uploaded but unacknowledged");
  assert.equal(stuck?.segmentCount, 4);

  w.clock.advance(6 * 60_000);
  const report = await reconcileRecordings(w.deps);
  assert.equal(report.repairedCommits, 3);
  const repaired = await w.repo.getRecording(church.id, recording.id);
  assert.equal(repaired?.status, "ready");
  assert.equal(repaired?.segmentCount, 7);
});

test("a relay that dies without saying goodbye does not leave a recording processing forever", async () => {
  const w = world();
  const church = w.repo.addChurch();
  const relay = new FakeRelay(w, church.id);
  await relay.connect();
  const { session, recording } = await goLive(w, church.id, w.repo.addEvent(church.id).id);
  await relay.record(6);
  await end(w, session);
  // No take-ended, no further segments: the relay box is gone.

  assert.equal((await w.repo.getRecording(church.id, recording.id))?.status, "processing");
  w.clock.advance(16 * 60_000);
  await reconcileRecordings(w.deps);
  const settled = await w.repo.getRecording(church.id, recording.id);
  assert.equal(settled?.status, "ready");
  assert.equal(settled?.segmentCount, 6);
});

test("duplicate and out-of-order relay callbacks converge on the same recording", async () => {
  const w = world();
  const church = w.repo.addChurch();
  const relay = new FakeRelay(w, church.id);
  await relay.connect();
  const { session, recording } = await goLive(w, church.id, w.repo.addEvent(church.id).id);
  await relay.record(3);

  // The same batch again: nothing is uploaded twice and nothing is counted twice.
  const again = await relay.deliver([
    { kind: "init", seq: 0 },
    { kind: "segment", seq: 1, startedAt: relay.segmentStart(1), durationSec: 6, bytes: 1001 },
  ]);
  assert.deepEqual(
    again.map((decision) => decision.action),
    ["done", "done"],
  );
  await handleCommit(w.deps, church.id, {
    path: `live/${church.id}`,
    takeId: relay.takeId,
    items: [{ kind: "segment", seq: 1, bytes: 1001 }],
  });
  assert.equal((await w.repo.getRecording(church.id, recording.id))?.segmentCount, 3);

  // "Take ended" arrives before the last segments were even prepared.
  w.repo.endSession(session.id, w.clock.iso(3 * 6000));
  await onBroadcastEnded(w.deps, church.id, session.id);
  await handleTakeEvent(w.deps, church.id, {
    path: `live/${church.id}`,
    takeId: relay.takeId,
    event: "ended",
    at: w.clock.iso(3 * 6000),
    lastSeq: 5,
  });
  assert.equal(
    (await w.repo.getRecording(church.id, recording.id))?.status,
    "processing",
    "sequences 3–5 have not been reported yet, so the recording is not complete",
  );

  await relay.record(3);
  const settled = await w.repo.getRecording(church.id, recording.id);
  assert.equal(settled?.status, "ready");
  assert.equal(settled?.segmentCount, 6);
});

test("a broadcast with no video fails honestly, and comes back if late video arrives", async () => {
  const w = world();
  const church = w.repo.addChurch();
  const { session, recording } = await goLive(w, church.id, w.repo.addEvent(church.id).id);
  const relay = new FakeRelay(w, church.id);
  w.clock.advance(60_000);
  await end(w, session);
  w.clock.advance(6 * 60_000);
  await reconcileRecordings(w.deps);

  const failed = await w.repo.getRecording(church.id, recording.id);
  assert.equal(failed?.status, "failed");
  assert.equal(failed?.failureReason, "nothing_recorded");
  assert.equal(recordingPhase(toState(failed!)).phase, "needs_attention");

  // The relay was offline and replays what it recorded during the broadcast.
  relay.takeStart = session.createdAt;
  relay.takeId = "take_late_upload";
  relay.seq = 0;
  const revived = await relay.deliver([
    { kind: "init", seq: 0, bytes: H264_INIT.length },
    { kind: "segment", seq: 0, startedAt: relay.segmentStart(0), durationSec: 6, bytes: 900 },
    { kind: "segment", seq: 1, startedAt: relay.segmentStart(1), durationSec: 6, bytes: 900 },
  ]);
  assert.ok(revived.filter((d) => d.kind === "segment").every((d) => d.action === "upload"));
  relay.seq = 2;
  await relay.disconnect();
  const back = await w.repo.getRecording(church.id, recording.id);
  assert.equal(back?.status, "ready");
  assert.equal(back?.segmentCount, 2);
});

test("a recording in a format phones cannot play is ready but needs attention, never publishable", async () => {
  const w = world();
  const church = w.repo.addChurch();
  const relay = new FakeRelay(w, church.id, HEVC_INIT);
  await relay.connect();
  const { session, recording } = await goLive(w, church.id, w.repo.addEvent(church.id).id);
  await relay.record(3);
  await end(w, session);
  await relay.disconnect();

  const settled = await w.repo.getRecording(church.id, recording.id);
  assert.equal(settled?.status, "ready");
  assert.equal(settled?.mobilePlayable, false);
  assert.equal(settled?.renditionReason, "video_codec_unsupported");
  const view = recordingPhase(toState(settled!));
  assert.equal(view.phase, "needs_attention");
  assert.match(view.detail ?? "", /H\.264/);
  assert.doesNotMatch(view.detail ?? "", /hvc1|hevc|avc1/i, "no codec names for a volunteer");
});

test("segments missing from storage at verification are dropped, not served as holes", async () => {
  const w = world();
  const church = w.repo.addChurch();
  const relay = new FakeRelay(w, church.id);
  await relay.connect();
  const { session, recording } = await goLive(w, church.id, w.repo.addEvent(church.id).id);
  await relay.record(5);
  const [victim] = (await w.repo.listSegments(recording.id)).filter((segment) => segment.seq === 2);
  w.storage.objects.delete(w.storage.key("stream-recordings", victim.storagePath));

  await end(w, session);
  await relay.disconnect();
  const settled = await w.repo.getRecording(church.id, recording.id);
  assert.equal(settled?.status, "ready");
  assert.equal(settled?.segmentCount, 4);
  assert.equal(settled?.mobilePlayable, true);
  const playlist = buildVodPlaylist({
    segments: await w.repo.listSegments(recording.id),
    trimStartSec: 0,
    trimEndSec: null,
    initUri: (take) => `init/${take}.mp4`,
    segmentUri: (segment) => `seg/${segment.seq}.m4s`,
  });
  assert.doesNotMatch(playlist, /seg\/2\.m4s/);
  assert.match(playlist, /#EXT-X-DISCONTINUITY/, "the gap is a clean jump");
});

test("scenario F: one church's relay path can never touch another church's recording", async () => {
  const w = world();
  const churchA = w.repo.addChurch({ name: "A" });
  const churchB = w.repo.addChurch({ name: "B" });
  const relayA = new FakeRelay(w, churchA.id);
  await relayA.connect("sametake");
  const { recording: recordingA } = await goLive(w, churchA.id, w.repo.addEvent(churchA.id).id);
  await relayA.record(3);

  // Church B's path, church A's take id: a different take row, and no B broadcast.
  const decisions = await handlePrepare(w.deps, churchB.id, {
    path: `live/${churchB.id}`,
    takeId: relayA.takeId,
    items: [{ kind: "segment", seq: 3, startedAt: w.clock.iso(), durationSec: 6 }],
  });
  assert.equal(decisions.items[0].action, "skip");

  const commit = await handleCommit(w.deps, churchB.id, {
    path: `live/${churchB.id}`,
    takeId: relayA.takeId,
    items: [{ kind: "segment", seq: 0, bytes: 1 }],
  });
  assert.equal(commit.committed, 0, "B's commit cannot acknowledge A's segment");

  assert.equal(await w.repo.getRecording(churchB.id, recordingA.id), null);
  assert.equal((await w.repo.getRecording(churchA.id, recordingA.id))?.segmentCount, 3);

  // Every stored path is under the owning church.
  for (const key of w.storage.objects.keys()) {
    assert.ok(key.includes(churchA.id) && !key.includes(churchB.id));
  }
});

test("the live indicator reflects backend evidence only", () => {
  const now = Date.parse("2026-09-20T15:00:00Z");
  const base = {
    broadcastActive: true,
    videoArriving: true,
    videoSince: new Date(now - 10 * 60_000).toISOString(),
    lastSegmentAt: null as string | null,
    relay: null,
    now,
  };
  assert.equal(liveRecordingIndicator(base).state, "attention", "video for ten minutes, nothing saved");
  assert.equal(
    liveRecordingIndicator({ ...base, videoSince: new Date(now - 10_000).toISOString() }).state,
    "starting",
  );
  assert.equal(
    liveRecordingIndicator({ ...base, lastSegmentAt: new Date(now - 20_000).toISOString() }).state,
    "recording",
  );
  assert.equal(
    liveRecordingIndicator({
      ...base,
      relay: {
        heartbeatAt: new Date(now - 5_000).toISOString(),
        recorderRunning: true,
        lastSegmentClosedAt: new Date(now - 4_000).toISOString(),
      },
    }).state,
    "recording",
  );
  assert.equal(liveRecordingIndicator({ ...base, videoArriving: false }).state, "waiting_for_video");
  assert.equal(liveRecordingIndicator({ ...base, broadcastActive: false }).state, "off");
});

test("the relay heartbeat records stream health without touching recordings", async () => {
  const w = world();
  const church = w.repo.addChurch();
  await handleHeartbeat(w.deps, church.id, {
    path: `live/${church.id}`,
    takeId: "take_heartbeat",
    publishing: true,
    recorder: { running: true, version: "2", pendingUploads: 1, reconnects: 2 },
    ingest: { bitrateKbps: 4200, width: 1920, height: 1080, fps: 30, videoCodec: "h264", audioCodec: "aac" },
  });
  const status = await w.repo.getIngestStatus(church.id);
  assert.equal(status?.bitrateKbps, 4200);
  assert.equal(status?.reconnects, 2);
  assert.equal(w.repo.recordings.size, 0);
});

test("deleting purges the media but keeps the row", async () => {
  const w = world();
  const church = w.repo.addChurch();
  const relay = new FakeRelay(w, church.id);
  relay.frameEvery = 2;
  await relay.connect();
  const { session, recording } = await goLive(w, church.id, w.repo.addEvent(church.id).id);
  await relay.record(4);
  await end(w, session);
  await relay.disconnect();

  const before = await w.repo.getRecording(church.id, recording.id);
  assert.ok(before?.autoPosterUrl, "a frame was chosen as the default thumbnail");

  const row = w.repo.recordings.get(recording.id)!;
  row.deletedAt = w.clock.iso();
  row.status = "deleted";
  assert.equal(await purgeRecordingMedia(w.deps, { ...row }), true);
  const segmentKeys = [...w.storage.objects.keys()].filter((key) => key.endsWith(".m4s"));
  assert.equal(segmentKeys.length, 0);
  assert.ok(w.repo.recordings.get(recording.id)?.purgedAt);
});

test("advancing a settled recording is a no-op", async () => {
  const w = world();
  const church = w.repo.addChurch();
  const relay = new FakeRelay(w, church.id);
  await relay.connect();
  const { session, recording } = await goLive(w, church.id, w.repo.addEvent(church.id).id);
  await relay.record(2);
  await end(w, session);
  await relay.disconnect();
  const settled = (await w.repo.getRecording(church.id, recording.id))!;
  const revision = settled.renditionRevision;
  assert.equal(await advanceRecording(w.deps, settled), "unchanged");
  assert.equal((await w.repo.getRecording(church.id, recording.id))?.renditionRevision, revision);
});

function toState(row: NonNullable<Awaited<ReturnType<FakeRecordingRepo["getRecording"]>>>) {
  return {
    status: row.status,
    sourceKind: row.sourceKind,
    mobilePlayable: row.mobilePlayable,
    renditionReason: row.renditionReason,
    renditionVerifiedAt: row.renditionVerifiedAt,
    mobileVisibility: row.mobileVisibility,
    mobilePublishedAt: row.mobilePublishedAt,
    mobileUnpublishedAt: row.mobileUnpublishedAt,
    webPublishedAt: row.webPublishedAt,
    webUnpublishedAt: row.webUnpublishedAt,
    failureReason: row.failureReason,
    deletedAt: row.deletedAt,
  };
}
