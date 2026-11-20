import assert from "node:assert/strict";
import test from "node:test";

import {
  decideVideoStop,
  ENCODER_STOP_GRACE_MS,
  VIDEO_SILENCE_GRACE_MS,
  videoEvidence,
  type VideoStopInput,
} from "@/lib/stream/video-stop";

const T0 = Date.parse("2026-11-22T15:00:00.000Z");
const at = (ms: number) => new Date(T0 + ms).toISOString();

function input(overrides: Partial<VideoStopInput>): VideoStopInput {
  return {
    sessionStatus: "live",
    liveSince: at(0),
    videoArriving: false,
    lastVideoAt: null,
    stoppedAt: null,
    now: T0,
    ...overrides,
  };
}

test("grace windows are named, sensible and ordered", () => {
  assert.ok(ENCODER_STOP_GRACE_MS >= 60_000 && ENCODER_STOP_GRACE_MS <= 90_000);
  assert.ok(VIDEO_SILENCE_GRACE_MS > ENCODER_STOP_GRACE_MS, "silence is weaker evidence than a reported stop");
});

test("Stop Streaming waits out the reconnect grace, then ends the service", () => {
  const stopped = { lastVideoAt: at(10 * 60_000), stoppedAt: at(10 * 60_000 + 500) };
  const soon = decideVideoStop(input({ ...stopped, now: T0 + 10 * 60_000 + 30_000 }));
  assert.equal(soon.action, "wait");
  assert.equal(soon.action === "wait" && soon.reason, "stopped");
  assert.equal(soon.action === "wait" && soon.endsAt, at(10 * 60_000 + 500 + ENCODER_STOP_GRACE_MS));

  const due = decideVideoStop(input({ ...stopped, now: T0 + 10 * 60_000 + 500 + ENCODER_STOP_GRACE_MS }));
  assert.equal(due.action, "end");
  assert.equal(due.action === "end" && due.reason, "stopped");
});

test("a brief drop that reconnects keeps the service live", () => {
  // Stopped, then the software reconnected: video is arriving again.
  const back = decideVideoStop(
    input({ stoppedAt: at(60_000), lastVideoAt: at(65_000), videoArriving: true, now: T0 + 10 * 60_000 }),
  );
  assert.deepEqual(back, { action: "keep" });
});

test("a stop reported before newer video is not a stop; silence after it is measured from the last video", () => {
  const decision = decideVideoStop(
    input({ stoppedAt: at(60_000), lastVideoAt: at(90_000), now: T0 + 90_000 + 30_000 }),
  );
  assert.equal(decision.action, "wait");
  assert.equal(decision.action === "wait" && decision.reason, "silent");
  assert.equal(decision.action === "wait" && decision.endsAt, at(90_000 + VIDEO_SILENCE_GRACE_MS));
});

test("without any stop message, heartbeats that stopped arriving end the service after the longer backstop", () => {
  const lastVideoAt = at(5 * 60_000);
  assert.equal(decideVideoStop(input({ lastVideoAt, now: T0 + 5 * 60_000 + ENCODER_STOP_GRACE_MS })).action, "wait");
  const due = decideVideoStop(input({ lastVideoAt, now: T0 + 5 * 60_000 + VIDEO_SILENCE_GRACE_MS }));
  assert.equal(due.action, "end");
  assert.equal(due.action === "end" && due.reason, "silent");
});

test("only a live service can end this way, and never while video is arriving", () => {
  const stoppedLongAgo = { stoppedAt: at(0), now: T0 + 60 * 60_000 };
  for (const sessionStatus of ["preparing", "waiting_for_encoder", "ended", "error"] as const) {
    assert.deepEqual(decideVideoStop(input({ ...stoppedLongAgo, sessionStatus })), { action: "keep" }, sessionStatus);
  }
  assert.deepEqual(decideVideoStop(input({ ...stoppedLongAgo, videoArriving: true })), { action: "keep" });
});

test("a stop from before this service went live does not end it early", () => {
  // Leftover stop time from last week's service: the new service went live after it.
  const decision = decideVideoStop(input({ stoppedAt: at(-7 * 24 * 60 * 60_000), liveSince: at(0), now: T0 + 30_000 }));
  assert.equal(decision.action, "wait");
  assert.equal(decision.action === "wait" && decision.reason, "silent");
  assert.equal(decision.action === "wait" && decision.endsAt, at(VIDEO_SILENCE_GRACE_MS));
});

test("no evidence at all never ends a service by guesswork", () => {
  assert.deepEqual(decideVideoStop(input({ liveSince: null, now: T0 + 24 * 60 * 60_000 })), { action: "keep" });
  assert.deepEqual(decideVideoStop(input({ liveSince: "not a date", now: T0 + 24 * 60 * 60_000 })), { action: "keep" });
});

test("video evidence combines the relay heartbeat, its reported stop and the recorder heartbeat", () => {
  const now = T0 + 120_000;
  const fresh = videoEvidence({
    preview: { active: false, lastBeatAt: null, stoppedAt: at(100_000) },
    ingest: { publishing: true, heartbeatAt: at(110_000) },
    ingestTtlMs: 60_000,
    now,
  });
  assert.deepEqual(fresh, { videoArriving: true, lastVideoAt: at(110_000), stoppedAt: at(100_000) });

  const stale = videoEvidence({
    preview: { active: false, lastBeatAt: at(10_000), stoppedAt: null },
    ingest: { publishing: true, heartbeatAt: at(20_000) },
    ingestTtlMs: 60_000,
    now,
  });
  assert.equal(stale.videoArriving, false);
  assert.equal(stale.lastVideoAt, at(20_000));

  const recorderIdle = videoEvidence({
    preview: { active: false, lastBeatAt: null, stoppedAt: at(100_000) },
    ingest: { publishing: false, heartbeatAt: at(119_000) },
    ingestTtlMs: 60_000,
    now,
  });
  assert.deepEqual(recorderIdle, { videoArriving: false, lastVideoAt: null, stoppedAt: at(100_000) });
});
