import { createHash, randomBytes, randomUUID } from "node:crypto";

import { assessRendition } from "@/lib/media/v1/rendition";
import {
  defaultRecordingTitle,
  finalizeDecision,
  frameStoragePath,
  initStoragePath,
  pickSessionForSegment,
  recordingCompleteness,
  recordingPrefix,
  segmentStoragePath,
  ABANDONED_SESSION_MS,
  type SessionWindow,
} from "@/lib/stream/recording-model";
import type {
  RecordingRecord,
  RecordingRepo,
  RecordingStorage,
  SegmentRecord,
  TakeRecord,
} from "@/lib/stream/recording-repo";
import type {
  CommitBody,
  HeartbeatBody,
  PrepareBody,
  PrepareDecision,
  TakeEventBody,
} from "@/lib/stream/relay-protocol";

/**
 * The livestream recording lifecycle.
 *
 *   Go Live ─▶ recording ─▶ (End) ─▶ processing ─▶ finalize ─▶ verify ─▶ ready
 *                                                       └──▶ failed (nothing recorded)
 *
 * Driven from four directions, and correct whichever arrives first or twice:
 *
 *   * the dashboard (Go Live / End),
 *   * the relay's signed callbacks (prepare, commit, take, heartbeat),
 *   * the reconciler, every two minutes, for anything either of them missed,
 *   * the dashboard's status poll, which nudges its own church's recording.
 *
 * Every function takes its dependencies explicitly — repository, storage, clock
 * — so the whole lifecycle runs against in-memory fakes in tests with the same
 * uniqueness semantics as the database.
 */

export const MEDIA_BUCKET = "stream-recordings";
export const FRAME_BUCKET = "church-covers";

/** An init segment is a few kilobytes. Anything this large is not one. */
const MAX_INIT_BYTES = 2 * 1024 * 1024;

export type RecordingPublisher = (recording: RecordingRecord) => Promise<void>;

export type RecordingNotifier = {
  serviceLive?: (input: { churchId: string; sessionId: string; eventId: string }) => Promise<void>;
};

export type LifecycleDeps = {
  repo: RecordingRepo;
  storage: RecordingStorage;
  now?: () => number;
  /** Structured, secret-free. Defaults to one JSON line on stdout. */
  log?: (event: string, fields: Record<string, unknown>) => void;
  /** Runs auto-publish. Omitted in contexts that must never publish. */
  autoPublish?: RecordingPublisher;
};

function clock(deps: LifecycleDeps): number {
  return deps.now ? deps.now() : Date.now();
}

function iso(deps: LifecycleDeps, offsetMs = 0): string {
  return new Date(clock(deps) + offsetMs).toISOString();
}

export function logRecordingEvent(event: string, fields: Record<string, unknown>): void {
  // One line, machine-readable, and never a URL, a path, a key or a token.
  console.info(JSON.stringify({ msg: "recording", event, ...fields }));
}

function log(deps: LifecycleDeps, event: string, fields: Record<string, unknown>): void {
  (deps.log ?? logRecordingEvent)(event, fields);
}

// ---------------------------------------------------------------------------
// Go Live and End
// ---------------------------------------------------------------------------

/**
 * Creates the broadcast's recording row, or returns the one that exists.
 *
 * Called at Go Live so the recording exists — with the service's title, event
 * and session — from the first second, and again defensively by the relay path
 * in case Go Live's call was lost.
 */
export async function ensureRecordingForSession(
  deps: LifecycleDeps,
  session: SessionWindow,
): Promise<RecordingRecord> {
  const existing = await deps.repo.getRecordingForSession(session.churchId, session.id);
  if (existing) return existing;

  const [church, event] = await Promise.all([
    deps.repo.getChurch(session.churchId),
    session.streamEventId ? deps.repo.getEvent(session.churchId, session.streamEventId) : null,
  ]);

  const id = randomUUID();
  const recording = await deps.repo.createSegmentsRecording({
    id,
    churchId: session.churchId,
    sessionId: session.id,
    eventId: session.streamEventId,
    title: defaultRecordingTitle(
      event?.title ?? session.title,
      session.createdAt,
      church?.timezone ?? "America/New_York",
    ),
    storagePath: recordingPrefix(session.churchId, id),
  });

  if (recording.id === id) {
    log(deps, "recording_created", {
      churchId: session.churchId,
      recordingId: recording.id,
      sessionId: session.id,
    });
  }
  return recording;
}

/**
 * The operator ended the broadcast. The recording moves to `processing` and
 * FaithForm keeps collecting whatever the relay still has in flight.
 */
export async function onBroadcastEnded(
  deps: LifecycleDeps,
  churchId: string,
  sessionId: string,
): Promise<RecordingRecord | null> {
  const recording = await deps.repo.getRecordingForSession(churchId, sessionId);
  if (!recording) return null;
  if (recording.status === "recording") {
    await deps.repo.updateRecording(churchId, recording.id, {
      status: "processing",
      processingStartedAt: iso(deps),
    });
    log(deps, "stream_ended", { churchId, recordingId: recording.id, sessionId });
  }
  const fresh = await deps.repo.getRecording(churchId, recording.id);
  if (fresh) await advanceRecording(deps, fresh);
  return deps.repo.getRecording(churchId, recording.id);
}

// ---------------------------------------------------------------------------
// Relay: prepare
// ---------------------------------------------------------------------------

/**
 * The relay has closed some segments (and maybe an init segment and a frame)
 * and asks what to do with each.
 *
 * Each segment is attributed to the broadcast whose window contains it — by
 * its own timestamp, so a late or retried batch lands in the right recording.
 * Segments outside any broadcast are skipped. Anything already stored is
 * reported done, so a retried batch never uploads twice.
 */
export async function handlePrepare(
  deps: LifecycleDeps,
  churchId: string,
  body: PrepareBody,
): Promise<{ items: PrepareDecision[] }> {
  const items = [...body.items].sort((a, b) =>
    a.kind === b.kind ? a.seq - b.seq : a.kind === "init" ? -1 : b.kind === "init" ? 1 : 0,
  );
  const segments = items.filter((item) => item.kind === "segment");

  let take = await deps.repo.upsertTake(churchId, body.takeId, {
    startedAt: body.takeStartedAt ?? null,
  });

  // Only sessions that could contain one of these segments.
  const times = segments
    .filter((segment) => segment.startedAt)
    .map((segment) => Date.parse(segment.startedAt as string));
  const sessions =
    times.length > 0
      ? await deps.repo.listSessionsInRange(
          churchId,
          new Date(Math.min(...times) - 60_000).toISOString(),
          new Date(Math.max(...times) + 120_000).toISOString(),
        )
      : [];

  const existingSegments = new Map(
    (await deps.repo.getSegments(take.id, segments.map((segment) => segment.seq))).map(
      (segment) => [segment.seq, segment],
    ),
  );

  const decisions = new Map<string, PrepareDecision>();
  const key = (kind: string, seq: number) => `${kind}:${seq}`;
  const touchedRecordings = new Set<string>();

  for (const item of segments) {
    const existing = existingSegments.get(item.seq);
    if (existing) {
      decisions.set(key("segment", item.seq), await uploadOrDone(deps, existing.status, existing.storagePath, "segment", item.seq, MEDIA_BUCKET));
      continue;
    }
    if (!item.startedAt || !item.durationSec) {
      decisions.set(key("segment", item.seq), { kind: "segment", seq: item.seq, action: "skip" });
      continue;
    }

    const session = pickSessionForSegment(
      { startedAt: item.startedAt, durationSec: item.durationSec },
      sessions,
    );
    if (!session) {
      decisions.set(key("segment", item.seq), { kind: "segment", seq: item.seq, action: "skip" });
      continue;
    }

    const recording = await ensureRecordingForSession(deps, session);
    if (recording.deletedAt || recording.status === "deleted") {
      decisions.set(key("segment", item.seq), { kind: "segment", seq: item.seq, action: "skip" });
      continue;
    }

    const segment = await deps.repo.insertSegment({
      churchId,
      recordingId: recording.id,
      takeId: take.id,
      seq: item.seq,
      startedAt: new Date(item.startedAt).toISOString(),
      durationSec: Math.round(item.durationSec * 1000) / 1000,
      byteSize: item.bytes ?? null,
      storagePath: segmentStoragePath(churchId, recording.id, take.id, item.seq),
    });
    touchedRecordings.add(recording.id);

    // A broadcast declared empty that turns out to have video after all —
    // because the relay was unreachable and has just caught up — comes back.
    if (recording.status === "failed") {
      await deps.repo.updateRecording(churchId, recording.id, {
        status: "processing",
        failedAt: null,
        failureReason: null,
        failureDetail: null,
      });
      log(deps, "reconciliation_repair", {
        churchId,
        recordingId: recording.id,
        repair: "late_segments_revived_recording",
      });
    }

    decisions.set(
      key("segment", item.seq),
      await uploadOrDone(deps, segment.status, segment.storagePath, "segment", item.seq, MEDIA_BUCKET),
    );
  }

  // The high-water mark: everything up to here has now been reported.
  const reported = segments.filter((segment) => segment.startedAt);
  if (reported.length > 0) {
    const last = reported[reported.length - 1];
    take = await deps.repo.upsertTake(churchId, body.takeId, {
      seen: { seq: last.seq, startedAt: new Date(last.startedAt as string).toISOString() },
    });
  }

  for (const item of items) {
    if (item.kind === "init") {
      decisions.set(key("init", item.seq), await decideInit(deps, churchId, take, touchedRecordings.size > 0, item.seq));
    } else if (item.kind === "frame") {
      decisions.set(key("frame", item.seq), await decideFrame(deps, churchId, take, item.seq, item.startedAt));
    }
  }

  return { items: items.map((item) => decisions.get(key(item.kind, item.seq)) as PrepareDecision) };
}

async function uploadOrDone(
  deps: LifecycleDeps,
  status: "pending_upload" | "uploaded",
  path: string,
  kind: PrepareDecision["kind"],
  seq: number,
  bucket: string,
): Promise<PrepareDecision> {
  if (status === "uploaded") return { kind, seq, action: "done" };
  const uploadUrl = await deps.storage.createUploadUrl(bucket, path);
  // No URL is not a skip: the relay keeps the file and asks again.
  if (!uploadUrl) return { kind, seq, action: "later" };
  return { kind, seq, action: "upload", uploadUrl };
}

async function takeHasKeptSegments(deps: LifecycleDeps, take: TakeRecord): Promise<boolean> {
  if (take.highestSeenSeq === null) return false;
  // Any kept segment will do; check the most recent window cheaply.
  const from = Math.max(0, take.highestSeenSeq - 200);
  const seqs = Array.from({ length: take.highestSeenSeq - from + 1 }, (_, index) => from + index);
  const kept = await deps.repo.getSegments(take.id, seqs);
  if (kept.length > 0) return true;
  if (from === 0) return false;
  const early = await deps.repo.getSegments(
    take.id,
    Array.from({ length: Math.min(from, 200) }, (_, index) => index),
  );
  return early.length > 0;
}

async function decideInit(
  deps: LifecycleDeps,
  churchId: string,
  take: TakeRecord,
  keptInThisBatch: boolean,
  seq: number,
): Promise<PrepareDecision> {
  if (take.initStatus === "uploaded") return { kind: "init", seq, action: "done" };

  // An init segment is only worth storing if its take contributed something to
  // a broadcast. Until then, the relay keeps it and asks again.
  const needed = keptInThisBatch || take.initStatus === "pending_upload" || (await takeHasKeptSegments(deps, take));
  if (!needed) return { kind: "init", seq, action: "later" };

  const path = take.initStoragePath ?? initStoragePath(churchId, take.id);
  if (take.initStatus !== "pending_upload" || !take.initStoragePath) {
    await deps.repo.setTakeInit(take.id, { storagePath: path, status: "pending_upload" });
  }
  return uploadOrDone(deps, "pending_upload", path, "init", seq, MEDIA_BUCKET);
}

async function decideFrame(
  deps: LifecycleDeps,
  churchId: string,
  take: TakeRecord,
  seq: number,
  capturedAt: string | undefined,
): Promise<PrepareDecision> {
  const [existing] = await deps.repo.getFrames(take.id, [seq]);
  if (existing) {
    return uploadOrDone(deps, existing.status, existing.storagePath, "frame", seq, FRAME_BUCKET);
  }
  // A frame belongs to the recording its segment went to. No kept segment,
  // no frame: a picture of the preview is not a thumbnail for the service.
  const [segment] = await deps.repo.getSegments(take.id, [seq]);
  if (!segment) return { kind: "frame", seq, action: "skip" };

  const path = frameStoragePath(
    churchId,
    segment.recordingId,
    take.id,
    seq,
    randomBytes(6).toString("hex"),
  );
  const frame = await deps.repo.insertFrame({
    churchId,
    recordingId: segment.recordingId,
    takeId: take.id,
    seq,
    capturedAt: capturedAt ? new Date(capturedAt).toISOString() : segment.startedAt,
    storagePath: path,
    publicUrl: deps.storage.publicUrl(FRAME_BUCKET, path),
  });
  return uploadOrDone(deps, frame.status, frame.storagePath, "frame", seq, FRAME_BUCKET);
}

// ---------------------------------------------------------------------------
// Relay: commit
// ---------------------------------------------------------------------------

/**
 * The relay has uploaded these. Idempotent: committing twice changes nothing
 * the second time, because only `pending_upload` rows move.
 */
export async function handleCommit(
  deps: LifecycleDeps,
  churchId: string,
  body: CommitBody,
): Promise<{ committed: number }> {
  const take = await deps.repo.getTake(churchId, body.takeId);
  // A commit for a take this church never prepared is not ours to accept.
  if (!take) return { committed: 0 };

  const at = iso(deps);
  let committed = 0;
  const recordings = new Set<string>();

  const segmentItems = body.items.filter((item) => item.kind === "segment");
  if (segmentItems.length > 0) {
    const updated = await deps.repo.markSegmentsUploaded(
      take.id,
      segmentItems.map((item) => ({ seq: item.seq, bytes: item.bytes ?? null })),
      at,
    );
    committed += updated.length;
    for (const segment of updated) recordings.add(segment.recordingId);
    // A duplicate commit updates nothing; still refresh the recordings the
    // segments belong to so stats heal if a previous refresh was lost.
    if (updated.length === 0) {
      for (const segment of await deps.repo.getSegments(take.id, segmentItems.map((item) => item.seq))) {
        recordings.add(segment.recordingId);
      }
    }
  }

  const initItem = body.items.find((item) => item.kind === "init");
  if (initItem && take.initStatus === "pending_upload") {
    if (initItem.bytes !== undefined && initItem.bytes > MAX_INIT_BYTES) {
      // Not an init segment. Leave it pending; verification will refuse it.
      log(deps, "webhook_rejected", { churchId, reason: "init_too_large" });
    } else {
      await deps.repo.setTakeInit(take.id, { status: "uploaded", bytes: initItem.bytes ?? null });
      committed += 1;
    }
  }

  const frameItems = body.items.filter((item) => item.kind === "frame");
  if (frameItems.length > 0) {
    const frames = await deps.repo.markFramesUploaded(take.id, frameItems.map((item) => item.seq));
    committed += frames.length;
    for (const frame of frames) recordings.add(frame.recordingId);
  }

  for (const recordingId of recordings) {
    await deps.repo.refreshRecordingStats(churchId, recordingId);
    const recording = await deps.repo.getRecording(churchId, recordingId);
    if (!recording) continue;
    if (recording.segmentCount > 0 && recording.status === "recording" && recording.segmentCount <= 2) {
      log(deps, "recording_confirmed", { churchId, recordingId });
    }
    await chooseAutoPoster(deps, recording);
    if (recording.status === "processing" || (recording.status === "ready" && needsReverification(recording))) {
      await advanceRecording(deps, recording);
    }
  }

  return { committed };
}

// ---------------------------------------------------------------------------
// Relay: take started / ended
// ---------------------------------------------------------------------------

export async function handleTakeEvent(
  deps: LifecycleDeps,
  churchId: string,
  body: TakeEventBody,
): Promise<{ ok: true }> {
  const at = new Date(body.at).toISOString();
  if (body.event === "started") {
    await deps.repo.upsertTake(churchId, body.takeId, { startedAt: at });
    log(deps, "ingest_connected", { churchId });
    return { ok: true };
  }

  const take = await deps.repo.upsertTake(churchId, body.takeId, {
    endedAt: at,
    lastSeq: body.lastSeq ?? null,
  });
  log(deps, "ingest_disconnected", { churchId, lastSeq: body.lastSeq ?? null });

  // Anything waiting on this take may now be complete.
  const open = await deps.repo.listRecordingsByStatus(["processing"], 50);
  for (const recording of open.filter((row) => row.churchId === churchId)) {
    await advanceRecording(deps, recording);
  }
  void take;
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Relay: heartbeat
// ---------------------------------------------------------------------------

export async function handleHeartbeat(
  deps: LifecycleDeps,
  churchId: string,
  body: HeartbeatBody,
): Promise<{ ok: true }> {
  if (body.takeId) {
    await deps.repo.upsertTake(churchId, body.takeId, { startedAt: body.takeStartedAt ?? null });
  }
  await deps.repo.upsertIngestStatus(churchId, {
    publishing: body.publishing,
    relayTakeId: body.takeId ?? null,
    recorderRunning: Boolean(body.recorder?.running),
    recorderVersion: body.recorder?.version ?? null,
    lastSegmentClosedAt: body.recorder?.lastSegmentClosedAt
      ? new Date(body.recorder.lastSegmentClosedAt).toISOString()
      : null,
    pendingUploads: body.recorder?.pendingUploads ?? 0,
    bitrateKbps: body.ingest?.bitrateKbps ?? null,
    width: body.ingest?.width ?? null,
    height: body.ingest?.height ?? null,
    fps: body.ingest?.fps ?? null,
    videoCodec: body.ingest?.videoCodec ?? null,
    audioCodec: body.ingest?.audioCodec ?? null,
    reconnects: body.recorder?.reconnects ?? 0,
    heartbeatAt: iso(deps),
  });
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Finalize and verify
// ---------------------------------------------------------------------------

function needsReverification(recording: RecordingRecord): boolean {
  if (recording.sourceKind !== "segments") return false;
  if (!recording.renditionVerifiedAt) return true;
  // A segment acknowledged after the verdict was taken is not covered by it.
  return (
    recording.lastSegmentAt !== null &&
    Date.parse(recording.lastSegmentAt) > Date.parse(recording.renditionVerifiedAt)
  );
}

export type AdvanceOutcome =
  | "recording"
  | "waiting"
  | "ready"
  | "not_playable"
  | "failed"
  | "unchanged";

/**
 * Moves one recording as far along its lifecycle as the evidence allows.
 * Safe to call at any time, from anywhere, any number of times.
 */
export async function advanceRecording(
  deps: LifecycleDeps,
  recording: RecordingRecord,
): Promise<AdvanceOutcome> {
  if (recording.sourceKind !== "segments" || recording.deletedAt) return "unchanged";

  if (recording.status === "recording") {
    const session = recording.streamSessionId
      ? await deps.repo.getSession(recording.churchId, recording.streamSessionId)
      : null;
    // The End that should have moved this on was missed — a crashed request,
    // a session ended by another path. Repair it.
    if (session && (session.status === "ended" || session.status === "error") && session.endedAt) {
      await deps.repo.updateRecording(recording.churchId, recording.id, {
        status: "processing",
        processingStartedAt: iso(deps),
      });
      log(deps, "reconciliation_repair", {
        churchId: recording.churchId,
        recordingId: recording.id,
        repair: "missed_broadcast_end",
      });
      const fresh = await deps.repo.getRecording(recording.churchId, recording.id);
      return fresh ? advanceRecording(deps, fresh) : "unchanged";
    }
    return "recording";
  }

  if (recording.status === "ready") {
    if (!needsReverification(recording)) return "unchanged";
    return verifyAndSettle(deps, recording);
  }

  if (recording.status !== "processing" && recording.status !== "failed") return "unchanged";
  if (recording.status === "failed" && recording.segmentCount === 0) return "unchanged";

  const session = recording.streamSessionId
    ? await deps.repo.getSession(recording.churchId, recording.streamSessionId)
    : null;
  const windowStart = session?.createdAt ?? recording.createdAt;
  const windowEnd =
    session?.endedAt ?? recording.processingStartedAt ?? recording.recordingEndedAt ?? iso(deps);

  const [segments, takes] = await Promise.all([
    deps.repo.listSegments(recording.id),
    deps.repo.listTakesInRange(recording.churchId, windowStart, windowEnd),
  ]);
  const takeIdsWithSegments = new Set(segments.map((segment) => segment.takeId));
  const takesById = new Map(takes.map((take) => [take.id, take]));
  for (const missing of await deps.repo.listTakesByIds(
    [...takeIdsWithSegments].filter((id) => !takesById.has(id)),
  )) {
    takesById.set(missing.id, missing);
  }
  const relevantTakes = [...takesById.values()];

  const pendingSegments = segments.filter((segment) => segment.status === "pending_upload").length;
  const pendingInits = relevantTakes.filter(
    (take) => takeIdsWithSegments.has(take.id) && take.initStatus !== "uploaded",
  ).length;
  const uploaded = segments.filter((segment) => segment.status === "uploaded");

  const completeness = recordingCompleteness({
    window: { from: windowStart, to: windowEnd },
    takes: relevantTakes,
    pendingSegments,
    pendingInits,
  });

  const lastActivity = [
    recording.lastSegmentAt,
    ...relevantTakes.map((take) => take.updatedAt),
  ]
    .filter((value): value is string => Boolean(value))
    .sort()
    .at(-1) ?? null;

  const decision = finalizeDecision({
    broadcastEndedAt: windowEnd,
    lastActivityAt: lastActivity,
    segmentCount: uploaded.length,
    completeness,
    now: clock(deps),
  });

  if (decision === "wait") return "waiting";

  if (decision === "empty") {
    if (recording.status !== "failed") {
      await deps.repo.updateRecording(recording.churchId, recording.id, {
        status: "failed",
        failedAt: iso(deps),
        failureReason: "nothing_recorded",
        failureDetail: `no segments; takes=${relevantTakes.length}`,
      });
      log(deps, "processing_failed", {
        churchId: recording.churchId,
        recordingId: recording.id,
        reason: "nothing_recorded",
      });
    }
    return "failed";
  }

  await deps.repo.updateRecording(recording.churchId, recording.id, {
    finalizedBy: decision === "timeout" ? "timeout" : "relay",
  });
  if (decision === "timeout") {
    log(deps, "reconciliation_repair", {
      churchId: recording.churchId,
      recordingId: recording.id,
      repair: "finalized_by_timeout",
      pendingSegments,
      pendingInits,
    });
    // What never arrived is dropped from the index, so the playlist has no holes
    // that 404. The relay may still upload them later; they come back then.
    const abandoned = segments.filter((segment) => segment.status === "pending_upload");
    await deps.repo.deleteSegments(abandoned.map((segment) => segment.id));
  }

  const fresh = await deps.repo.getRecording(recording.churchId, recording.id);
  return fresh ? verifyAndSettle(deps, fresh) : "unchanged";
}

/**
 * Proves the recording is playable and moves it to `ready`.
 *
 * Every take's initialization segment — the part that declares the codecs — is
 * read and run through the same byte-level probe the rest of the media system
 * uses. Every indexed segment is checked against storage; one that is not there
 * is dropped from the index rather than left to 404 in a congregation's player.
 *
 * The verdict is bound to an identity: a SHA-256 over the init segments and
 * the segment manifest. Publishing is checked against it, so a publish can
 * never be bound to a segment list nobody verified.
 */
async function verifyAndSettle(
  deps: LifecycleDeps,
  recording: RecordingRecord,
): Promise<AdvanceOutcome> {
  const churchId = recording.churchId;
  let segments = (await deps.repo.listSegments(recording.id)).filter(
    (segment) => segment.status === "uploaded",
  );

  // Storage is the truth about what exists. One listing per take folder.
  const byTake = new Map<string, SegmentRecord[]>();
  for (const segment of segments) {
    byTake.set(segment.takeId, [...(byTake.get(segment.takeId) ?? []), segment]);
  }
  const missing: SegmentRecord[] = [];
  for (const [takeId, takeSegments] of byTake) {
    const folder = `${recordingPrefix(churchId, recording.id)}${takeId}`;
    const listing = await deps.storage.list(MEDIA_BUCKET, folder);
    if (!listing) {
      log(deps, "processing_deferred", { churchId, recordingId: recording.id, reason: "storage_unavailable" });
      return "waiting";
    }
    const present = new Map(listing.map((object) => [object.name, object.size]));
    for (const segment of takeSegments) {
      const name = segment.storagePath.split("/").pop() as string;
      if (!present.has(name)) missing.push(segment);
    }
  }
  if (missing.length > 0) {
    await deps.repo.deleteSegments(missing.map((segment) => segment.id));
    const gone = new Set(missing.map((segment) => segment.id));
    segments = segments.filter((segment) => !gone.has(segment.id));
    await deps.repo.refreshRecordingStats(churchId, recording.id);
    log(deps, "reconciliation_repair", {
      churchId,
      recordingId: recording.id,
      repair: "dropped_missing_segments",
      count: missing.length,
    });
  }

  if (segments.length === 0) {
    await deps.repo.updateRecording(churchId, recording.id, {
      status: "failed",
      failedAt: iso(deps),
      failureReason: missing.length > 0 ? "segments_missing" : "nothing_recorded",
    });
    log(deps, "processing_failed", { churchId, recordingId: recording.id });
    return "failed";
  }

  const takes = await deps.repo.listTakesByIds([...new Set(segments.map((segment) => segment.takeId))]);
  const digest = createHash("sha256");
  let verdict: ReturnType<typeof assessRendition> | null = null;
  let refusal: ReturnType<typeof assessRendition> | null = null;

  for (const take of takes.sort((a, b) => (a.startedAt ?? "").localeCompare(b.startedAt ?? ""))) {
    if (!take.initStoragePath || take.initStatus !== "uploaded") {
      refusal = refusal ?? { ...assessRendition(new Uint8Array(0)), reason: "codec_config_missing" };
      continue;
    }
    const bytes = await deps.storage.download(MEDIA_BUCKET, take.initStoragePath);
    if (!bytes) {
      log(deps, "processing_deferred", { churchId, recordingId: recording.id, reason: "init_unreadable" });
      return "waiting";
    }
    if (bytes.length > MAX_INIT_BYTES) {
      refusal = refusal ?? { ...assessRendition(new Uint8Array(0)), reason: "file_malformed" };
      continue;
    }
    digest.update(bytes);
    const assessed = assessRendition(bytes);
    if (!assessed.playable) refusal = refusal ?? assessed;
    else verdict = verdict ?? assessed;
  }

  for (const segment of segments) {
    digest.update(`${segment.takeId}:${segment.seq}:${segment.byteSize ?? 0}\n`);
  }

  const final = refusal ?? verdict;
  const playable = refusal === null && verdict !== null;
  const totalBytes = segments.reduce((sum, segment) => sum + (segment.byteSize ?? 0), 0);

  const written = await deps.repo.recordRendition({
    churchId,
    recordingId: recording.id,
    playable,
    kind: playable ? "hls" : null,
    reason: final?.reason ?? "codec_config_missing",
    container: final?.container ?? null,
    videoCodec: final?.videoCodec ?? null,
    audioCodec: final?.audioCodec ?? null,
    videoProfile: final?.videoProfile ?? null,
    audioProfile: final?.audioProfile ?? null,
    audioSampleRate: final?.audioSampleRate ?? null,
    audioChannels: final?.audioChannels ?? null,
    objectSize: totalBytes > 0 ? totalBytes : segments.length,
    objectHash: digest.digest("hex"),
  });

  const wasReady = recording.status === "ready";
  await deps.repo.updateRecording(churchId, recording.id, {
    status: "ready",
    readyAt: recording.readyAt ?? iso(deps),
    failedAt: null,
    failureReason: null,
  });

  if (!wasReady) {
    log(deps, playable ? "recording_ready" : "recording_not_playable", {
      churchId,
      recordingId: recording.id,
      segments: segments.length,
      revision: written.revision,
      reason: playable ? undefined : final?.reason,
    });
  }

  if (playable && deps.autoPublish) {
    const settled = await deps.repo.getRecording(churchId, recording.id);
    if (settled) {
      try {
        await deps.autoPublish(settled);
      } catch (error) {
        log(deps, "publish_failed", {
          churchId,
          recordingId: recording.id,
          via: "automatic",
          error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
        });
      }
    }
  }

  return playable ? "ready" : "not_playable";
}

/**
 * Picks the frame nearest a quarter of the way in — past the welcome, before
 * the sermon's end — unless one has been chosen already.
 */
async function chooseAutoPoster(deps: LifecycleDeps, recording: RecordingRecord): Promise<void> {
  if (recording.autoPosterUrl) return;
  const frames = await deps.repo.listFrames(recording.id);
  if (frames.length === 0) return;
  const pick = frames[Math.min(frames.length - 1, Math.floor(frames.length / 4))];
  await deps.repo.updateRecording(recording.churchId, recording.id, { autoPosterUrl: pick.publicUrl });
}

// ---------------------------------------------------------------------------
// Reconciliation
// ---------------------------------------------------------------------------

export type ReconcileReport = {
  advanced: number;
  ready: number;
  failed: number;
  closedTakes: number;
  repairedCommits: number;
  purged: number;
  abandonedSessions: number;
};

export type ReconcileHooks = {
  /** Ends a broadcast nobody ended. Wired to the real End in production. */
  endAbandonedSession?: (session: SessionWindow) => Promise<void>;
  ingestHeartbeatAt?: (churchId: string) => Promise<string | null>;
};

/**
 * Compares FaithForm's state with what the relay and storage prove, and
 * repairs the difference. Every step is idempotent and bounded.
 */
export async function reconcileRecordings(
  deps: LifecycleDeps,
  hooks: ReconcileHooks = {},
  options: { churchId?: string; limit?: number } = {},
): Promise<ReconcileReport> {
  const report: ReconcileReport = {
    advanced: 0,
    ready: 0,
    failed: 0,
    closedTakes: 0,
    repairedCommits: 0,
    purged: 0,
    abandonedSessions: 0,
  };
  const limit = options.limit ?? 25;
  const inScope = (row: { churchId: string }) => !options.churchId || row.churchId === options.churchId;

  // 1. Takes the relay never closed: a relay that died mid-service never says
  //    "ended". Closing them at their last reported segment lets the
  //    recordings waiting on them finish.
  for (const take of (await deps.repo.listStaleOpenTakes(iso(deps, -15 * 60_000), limit)).filter(inScope)) {
    await deps.repo.closeTake(
      take.id,
      take.highestSeenStart ?? take.startedAt ?? take.updatedAt,
      take.highestSeenSeq,
    );
    report.closedTakes += 1;
    log(deps, "reconciliation_repair", { churchId: take.churchId, repair: "closed_stale_take" });
  }

  // 2. Uploads the relay made but whose commit never arrived. Storage says the
  //    object is there; bind it.
  const stale = (await deps.repo.listStalePendingSegments(iso(deps, -5 * 60_000), limit * 4)).filter(inScope);
  const staleByFolder = new Map<string, SegmentRecord[]>();
  for (const segment of stale) {
    const folder = segment.storagePath.slice(0, segment.storagePath.lastIndexOf("/"));
    staleByFolder.set(folder, [...(staleByFolder.get(folder) ?? []), segment]);
  }
  for (const [folder, items] of staleByFolder) {
    const listing = await deps.storage.list(MEDIA_BUCKET, folder);
    if (!listing) continue;
    const present = new Map(listing.map((object) => [object.name, object.size]));
    const found = items.filter((segment) => present.has(segment.storagePath.split("/").pop() as string));
    if (found.length === 0) continue;
    const byTake = new Map<string, SegmentRecord[]>();
    for (const segment of found) byTake.set(segment.takeId, [...(byTake.get(segment.takeId) ?? []), segment]);
    for (const [takeId, segs] of byTake) {
      await deps.repo.markSegmentsUploaded(
        takeId,
        segs.map((segment) => ({
          seq: segment.seq,
          bytes: present.get(segment.storagePath.split("/").pop() as string) ?? segment.byteSize,
        })),
        iso(deps),
      );
    }
    for (const recordingId of new Set(found.map((segment) => segment.recordingId))) {
      await deps.repo.refreshRecordingStats(found[0].churchId, recordingId);
    }
    report.repairedCommits += found.length;
    log(deps, "reconciliation_repair", {
      churchId: found[0].churchId,
      repair: "bound_uncommitted_segments",
      count: found.length,
    });
  }

  // 3. Every recording that is not settled. (`ready` is settled: a verdict is
  //    only written once verification completed, and a segment that arrives
  //    afterwards re-verifies from its own commit.)
  const open = (await deps.repo.listRecordingsByStatus(["recording", "processing", "failed"], limit * 4))
    .filter(inScope)
    .filter(
      (row) => row.sourceKind === "segments" && !(row.status === "failed" && row.segmentCount === 0),
    )
    .slice(0, limit);
  for (const recording of open) {
    const outcome = await advanceRecording(deps, recording);
    if (outcome === "ready") report.ready += 1;
    else if (outcome === "failed") report.failed += 1;
    if (outcome !== "unchanged" && outcome !== "recording" && outcome !== "waiting") report.advanced += 1;
  }

  // 4. Broadcasts nobody ended: live for an hour with no video at all.
  if (hooks.endAbandonedSession) {
    for (const session of (await deps.repo.listOpenSessions(limit)).filter(inScope)) {
      const age = clock(deps) - Date.parse(session.createdAt);
      if (age < ABANDONED_SESSION_MS) continue;
      const heartbeat = hooks.ingestHeartbeatAt ? await hooks.ingestHeartbeatAt(session.churchId) : null;
      const silentFor = heartbeat ? clock(deps) - Date.parse(heartbeat) : age;
      if (silentFor < ABANDONED_SESSION_MS) continue;
      await hooks.endAbandonedSession(session);
      report.abandonedSessions += 1;
      log(deps, "reconciliation_repair", {
        churchId: session.churchId,
        sessionId: session.id,
        repair: "ended_abandoned_broadcast",
      });
    }
  }

  // 5. Deleted recordings whose media is still in storage.
  for (const recording of (await deps.repo.listRecordingsAwaitingPurge(limit)).filter(inScope)) {
    if (await purgeRecordingMedia(deps, recording)) report.purged += 1;
  }

  // 6. Replay ledger housekeeping.
  if (!options.churchId) await deps.repo.pruneNonces(iso(deps, -24 * 60 * 60_000));

  return report;
}

/**
 * Removes a deleted recording's media from storage. The row stays, so the
 * church's history still says the service existed and who deleted it.
 */
export async function purgeRecordingMedia(
  deps: LifecycleDeps,
  recording: RecordingRecord,
): Promise<boolean> {
  if (!recording.deletedAt) return false;

  const mediaPaths: string[] = [];
  const framePaths: string[] = [];
  if (recording.sourceKind === "segments") {
    const segments = await deps.repo.listSegments(recording.id);
    mediaPaths.push(...segments.map((segment) => segment.storagePath));
    framePaths.push(...(await deps.repo.listFrames(recording.id)).map((frame) => frame.storagePath));
    // An init segment is shared by every recording its take contributed to,
    // so it is left for the take; it is a few kilobytes and holds no picture.
  } else {
    mediaPaths.push(recording.storagePath);
  }

  const okMedia = mediaPaths.length === 0 || (await deps.storage.remove(MEDIA_BUCKET, mediaPaths));
  const okFrames = framePaths.length === 0 || (await deps.storage.remove(FRAME_BUCKET, framePaths));
  if (!okMedia || !okFrames) return false;

  await deps.repo.updateRecording(recording.churchId, recording.id, { purgedAt: iso(deps) });
  log(deps, "recording_purged", { churchId: recording.churchId, recordingId: recording.id });
  return true;
}

/**
 * "Try again" on a recording that needs attention. Re-runs whatever the
 * recording is waiting on; for a verified recording, takes a fresh verdict —
 * a transient storage failure yesterday is not a reason to stay unplayable.
 */
export async function retryRecording(
  deps: LifecycleDeps,
  recording: RecordingRecord,
): Promise<AdvanceOutcome> {
  if (recording.deletedAt || recording.sourceKind !== "segments") return "unchanged";
  if (recording.status === "ready") return verifyAndSettle(deps, recording);
  return advanceRecording(deps, recording);
}
