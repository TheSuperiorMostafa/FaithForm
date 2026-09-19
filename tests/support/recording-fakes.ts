import { randomUUID } from "node:crypto";

import type { SessionWindow } from "@/lib/stream/recording-model";
import {
  DEFAULT_RECORDING_SETTINGS,
  type ChurchSummary,
  type EventSummary,
  type FrameRecord,
  type IngestStatusRecord,
  type RecordingPatch,
  type RecordingRecord,
  type RecordingRepo,
  type RecordingSettings,
  type RecordingStorage,
  type RenditionWrite,
  type SegmentRecord,
  type TakeRecord,
} from "@/lib/stream/recording-repo";

/**
 * In-memory stand-ins for the database and object storage, at the lifecycle's
 * integration boundary.
 *
 * They are fakes of *boundaries*, not of FaithForm: every lifecycle decision
 * still runs for real. What they reproduce faithfully is what the lifecycle
 * relies on — the unique keys (church + take id, take + seq, one segmented
 * recording per session), "only pending rows move" on commit, aggregate stats
 * rather than increments, and immutable uploads (a second PUT to the same path
 * is refused, as `upsert: false` makes storage do).
 */

export class FakeClock {
  constructor(public value = Date.parse("2026-09-20T14:00:00Z")) {}
  now = () => this.value;
  advance(ms: number) {
    this.value += ms;
  }
  iso(offsetMs = 0) {
    return new Date(this.value + offsetMs).toISOString();
  }
}

type SessionRow = SessionWindow;

export class FakeRecordingRepo implements RecordingRepo {
  churches = new Map<string, ChurchSummary>();
  ingestMapped = new Set<string>();
  events = new Map<string, EventSummary & { churchId: string }>();
  settings = new Map<string, RecordingSettings>();
  sessions = new Map<string, SessionRow>();
  recordings = new Map<string, RecordingRecord>();
  takes = new Map<string, TakeRecord>();
  segments = new Map<string, SegmentRecord>();
  frames = new Map<string, FrameRecord>();
  ingest = new Map<string, IngestStatusRecord>();
  nonces = new Map<string, string>();
  renditionWrites: RenditionWrite[] = [];

  constructor(private readonly clock: FakeClock) {}

  // -- fixtures ------------------------------------------------------------

  addChurch(input: Partial<ChurchSummary> & { id?: string } = {}): ChurchSummary {
    const church: ChurchSummary = {
      id: input.id ?? randomUUID(),
      slug: input.slug ?? `church-${Math.random().toString(36).slice(2, 8)}`,
      name: input.name ?? "Grace Church",
      timezone: input.timezone ?? "America/New_York",
    };
    this.churches.set(church.id, church);
    this.ingestMapped.add(church.id);
    return church;
  }

  addEvent(churchId: string, title = "Sunday Worship"): EventSummary {
    const event = {
      id: randomUUID(),
      churchId,
      title,
      status: "live",
      mobileVisibility: "public",
      artworkUrl: null,
    };
    this.events.set(event.id, event);
    return event;
  }

  startSession(churchId: string, eventId: string | null, at = this.clock.iso()): SessionWindow {
    const session: SessionWindow = {
      id: randomUUID(),
      churchId,
      streamEventId: eventId,
      title: eventId ? (this.events.get(eventId)?.title ?? null) : null,
      createdAt: at,
      endedAt: null,
      status: "live",
    };
    this.sessions.set(session.id, session);
    return session;
  }

  endSession(sessionId: string, at = this.clock.iso()): void {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("no session");
    session.endedAt = at;
    session.status = "ended";
  }

  // -- RecordingRepo ---------------------------------------------------------

  async getChurch(churchId: string) {
    return this.churches.get(churchId) ?? null;
  }
  async churchHasStreamIngest(churchId: string) {
    return this.ingestMapped.has(churchId);
  }
  async getEvent(churchId: string, eventId: string) {
    const event = this.events.get(eventId);
    return event && event.churchId === churchId ? event : null;
  }
  async getSettings(churchId: string) {
    return { ...(this.settings.get(churchId) ?? DEFAULT_RECORDING_SETTINGS) };
  }

  async getSession(churchId: string, sessionId: string) {
    const session = this.sessions.get(sessionId);
    return session && session.churchId === churchId ? { ...session } : null;
  }
  async listSessionsInRange(churchId: string, from: string, to: string) {
    return [...this.sessions.values()]
      .filter(
        (session) =>
          session.churchId === churchId &&
          Date.parse(session.createdAt) <= Date.parse(to) &&
          (session.endedAt === null || Date.parse(session.endedAt) >= Date.parse(from)),
      )
      .map((session) => ({ ...session }));
  }
  async listOpenSessions(limit: number) {
    return [...this.sessions.values()]
      .filter((session) => ["preparing", "waiting_for_encoder", "live"].includes(session.status))
      .slice(0, limit)
      .map((session) => ({ ...session }));
  }

  async getRecording(churchId: string, recordingId: string) {
    const row = this.recordings.get(recordingId);
    return row && row.churchId === churchId ? { ...row } : null;
  }
  async getRecordingForSession(churchId: string, sessionId: string) {
    const row = [...this.recordings.values()].find(
      (recording) =>
        recording.churchId === churchId &&
        recording.streamSessionId === sessionId &&
        recording.sourceKind === "segments",
    );
    return row ? { ...row } : null;
  }
  async createSegmentsRecording(input: {
    id: string;
    churchId: string;
    sessionId: string;
    eventId: string | null;
    title: string;
    storagePath: string;
  }) {
    const existing = await this.getRecordingForSession(input.churchId, input.sessionId);
    if (existing) return existing; // the partial unique index
    const now = this.clock.iso();
    const row: RecordingRecord = {
      id: input.id,
      churchId: input.churchId,
      streamSessionId: input.sessionId,
      streamEventId: input.eventId,
      title: input.title,
      status: "recording",
      sourceKind: "segments",
      storagePath: input.storagePath,
      durationSec: null,
      trimStartSec: 0,
      trimEndSec: null,
      segmentCount: 0,
      totalBytes: 0,
      recordingStartedAt: null,
      recordingEndedAt: null,
      lastSegmentAt: null,
      processingStartedAt: null,
      readyAt: null,
      failedAt: null,
      failureReason: null,
      failureDetail: null,
      finalizedBy: null,
      autoPosterUrl: null,
      mobilePlayable: false,
      renditionReason: null,
      renditionVerifiedAt: null,
      renditionRevision: 0,
      renditionObjectHash: null,
      mobileVisibility: "none",
      mobilePublishedAt: null,
      mobileUnpublishedAt: null,
      mobilePosterUrl: null,
      mobileSummary: null,
      webPublishedAt: null,
      webUnpublishedAt: null,
      seriesId: null,
      speakerTags: [],
      deletedAt: null,
      purgedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    this.recordings.set(row.id, row);
    return { ...row };
  }
  async updateRecording(churchId: string, recordingId: string, patch: RecordingPatch) {
    const row = this.recordings.get(recordingId);
    if (!row || row.churchId !== churchId) return;
    Object.assign(row, Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)));
    row.updatedAt = this.clock.iso();
  }
  async listRecordingsByStatus(statuses: RecordingRecord["status"][], limit: number) {
    return [...this.recordings.values()]
      .filter((row) => statuses.includes(row.status) && !row.deletedAt)
      .sort((a, b) => a.updatedAt.localeCompare(b.updatedAt))
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }
  async listRecordingsAwaitingPurge(limit: number) {
    return [...this.recordings.values()]
      .filter((row) => row.deletedAt && !row.purgedAt)
      .slice(0, limit)
      .map((row) => ({ ...row }));
  }
  async refreshRecordingStats(churchId: string, recordingId: string) {
    const row = this.recordings.get(recordingId);
    if (!row || row.churchId !== churchId || row.sourceKind !== "segments") return;
    const uploaded = [...this.segments.values()].filter(
      (segment) => segment.recordingId === recordingId && segment.status === "uploaded",
    );
    row.segmentCount = uploaded.length;
    row.totalBytes = uploaded.reduce((sum, segment) => sum + (segment.byteSize ?? 0), 0);
    if (uploaded.length > 0) {
      row.durationSec =
        Math.round(uploaded.reduce((sum, segment) => sum + segment.durationSec, 0) * 1000) / 1000;
      const starts = uploaded.map((segment) => segment.startedAt).sort();
      row.recordingStartedAt = row.recordingStartedAt && row.recordingStartedAt < starts[0] ? row.recordingStartedAt : starts[0];
      row.recordingEndedAt = uploaded
        .map((segment) => new Date(Date.parse(segment.startedAt) + segment.durationSec * 1000).toISOString())
        .sort()
        .at(-1) as string;
      row.lastSegmentAt = uploaded
        .map((segment) => segment.uploadedAt as string)
        .sort()
        .at(-1) as string;
    }
    row.updatedAt = this.clock.iso();
  }
  async recordRendition(input: RenditionWrite) {
    this.renditionWrites.push(input);
    const row = this.recordings.get(input.recordingId);
    if (!row || row.churchId !== input.churchId) return { ok: false, playable: false, revision: 0 };
    const identified = input.objectHash !== null && input.objectSize !== null;
    row.mobilePlayable = input.playable && identified;
    row.renditionReason = input.reason;
    row.renditionVerifiedAt = this.clock.iso();
    row.renditionRevision += 1;
    row.renditionObjectHash = input.objectHash;
    return { ok: true, playable: row.mobilePlayable, revision: row.renditionRevision };
  }

  async upsertTake(churchId: string, relayTakeId: string, patch: {
    startedAt?: string | null;
    endedAt?: string | null;
    lastSeq?: number | null;
    seen?: { seq: number; startedAt: string };
  }) {
    let take = [...this.takes.values()].find(
      (row) => row.churchId === churchId && row.relayTakeId === relayTakeId,
    );
    if (!take) {
      take = {
        id: randomUUID(),
        churchId,
        relayTakeId,
        startedAt: patch.startedAt ?? null,
        endedAt: null,
        lastSeq: null,
        highestSeenSeq: null,
        highestSeenStart: null,
        initStoragePath: null,
        initStatus: "none",
        initBytes: null,
        updatedAt: this.clock.iso(),
      };
      this.takes.set(take.id, take);
    }
    let changed = false;
    if (patch.startedAt && !take.startedAt) {
      take.startedAt = patch.startedAt;
      changed = true;
    }
    if (patch.endedAt && !take.endedAt) {
      take.endedAt = patch.endedAt;
      changed = true;
    }
    if (patch.lastSeq !== undefined && patch.lastSeq !== null) {
      take.lastSeq = patch.lastSeq;
      changed = true;
    }
    if (patch.seen && (take.highestSeenSeq === null || patch.seen.seq > take.highestSeenSeq)) {
      take.highestSeenSeq = patch.seen.seq;
      take.highestSeenStart = patch.seen.startedAt;
      changed = true;
    }
    if (changed) take.updatedAt = this.clock.iso();
    return { ...take };
  }
  async getTake(churchId: string, relayTakeId: string) {
    const take = [...this.takes.values()].find(
      (row) => row.churchId === churchId && row.relayTakeId === relayTakeId,
    );
    return take ? { ...take } : null;
  }
  async listTakesByIds(ids: string[]) {
    return ids.map((id) => this.takes.get(id)).filter((take): take is TakeRecord => Boolean(take)).map((take) => ({ ...take }));
  }
  async listTakesInRange(churchId: string, from: string, to: string) {
    return [...this.takes.values()]
      .filter(
        (take) =>
          take.churchId === churchId &&
          (take.endedAt === null || Date.parse(take.endedAt) >= Date.parse(from)) &&
          (take.startedAt === null || Date.parse(take.startedAt) <= Date.parse(to)),
      )
      .map((take) => ({ ...take }));
  }
  async setTakeInit(takeId: string, patch: { storagePath?: string; status: TakeRecord["initStatus"]; bytes?: number | null }) {
    const take = this.takes.get(takeId);
    if (!take) return;
    take.initStatus = patch.status;
    if (patch.storagePath) take.initStoragePath = patch.storagePath;
    if (patch.bytes !== undefined) take.initBytes = patch.bytes;
    take.updatedAt = this.clock.iso();
  }

  async getSegments(takeId: string, seqs: number[]) {
    const wanted = new Set(seqs);
    return [...this.segments.values()]
      .filter((segment) => segment.takeId === takeId && wanted.has(segment.seq))
      .map((segment) => ({ ...segment }));
  }
  async insertSegment(row: Omit<SegmentRecord, "id" | "createdAt" | "uploadedAt" | "status">) {
    const [existing] = await this.getSegments(row.takeId, [row.seq]);
    if (existing) return existing; // unique (take_id, seq)
    if ([...this.segments.values()].some((segment) => segment.storagePath === row.storagePath)) {
      throw new Error("duplicate storage path");
    }
    const segment: SegmentRecord = {
      ...row,
      id: randomUUID(),
      status: "pending_upload",
      uploadedAt: null,
      createdAt: this.clock.iso(),
    };
    this.segments.set(segment.id, segment);
    return { ...segment };
  }
  async markSegmentsUploaded(takeId: string, items: Array<{ seq: number; bytes: number | null }>, at: string) {
    const updated: SegmentRecord[] = [];
    for (const item of items) {
      const segment = [...this.segments.values()].find(
        (row) => row.takeId === takeId && row.seq === item.seq && row.status === "pending_upload",
      );
      if (!segment) continue;
      segment.status = "uploaded";
      segment.uploadedAt = at;
      if (item.bytes !== null && item.bytes > 0) segment.byteSize = item.bytes;
      updated.push({ ...segment });
    }
    return updated;
  }
  async listSegments(recordingId: string) {
    return [...this.segments.values()]
      .filter((segment) => segment.recordingId === recordingId)
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.seq - b.seq)
      .map((segment) => ({ ...segment }));
  }
  async listStalePendingSegments(olderThan: string, limit: number) {
    return [...this.segments.values()]
      .filter((segment) => segment.status === "pending_upload" && segment.createdAt < olderThan)
      .slice(0, limit)
      .map((segment) => ({ ...segment }));
  }
  async deleteSegments(ids: string[]) {
    for (const id of ids) this.segments.delete(id);
  }

  async getFrames(takeId: string, seqs: number[]) {
    const wanted = new Set(seqs);
    return [...this.frames.values()]
      .filter((frame) => frame.takeId === takeId && wanted.has(frame.seq))
      .map((frame) => ({ ...frame }));
  }
  async insertFrame(row: Omit<FrameRecord, "id" | "status">) {
    const [existing] = await this.getFrames(row.takeId, [row.seq]);
    if (existing) return existing;
    const frame: FrameRecord = { ...row, id: randomUUID(), status: "pending_upload" };
    this.frames.set(frame.id, frame);
    return { ...frame };
  }
  async markFramesUploaded(takeId: string, seqs: number[]) {
    const wanted = new Set(seqs);
    const updated: FrameRecord[] = [];
    for (const frame of this.frames.values()) {
      if (frame.takeId === takeId && wanted.has(frame.seq)) {
        frame.status = "uploaded";
        updated.push({ ...frame });
      }
    }
    return updated;
  }
  async listFrames(recordingId: string) {
    return [...this.frames.values()]
      .filter((frame) => frame.recordingId === recordingId && frame.status === "uploaded")
      .sort((a, b) => a.capturedAt.localeCompare(b.capturedAt))
      .map((frame) => ({ ...frame }));
  }

  async upsertIngestStatus(churchId: string, patch: Omit<IngestStatusRecord, "churchId">) {
    this.ingest.set(churchId, { churchId, ...patch });
  }
  async getIngestStatus(churchId: string) {
    return this.ingest.get(churchId) ?? null;
  }

  async pruneNonces(olderThan: string) {
    for (const [nonce, at] of this.nonces) if (at < olderThan) this.nonces.delete(nonce);
  }
  async listStaleOpenTakes(olderThan: string, limit: number) {
    return [...this.takes.values()]
      .filter((take) => take.endedAt === null && take.updatedAt < olderThan)
      .slice(0, limit)
      .map((take) => ({ ...take }));
  }
  async closeTake(takeId: string, endedAt: string, lastSeq: number | null) {
    const take = this.takes.get(takeId);
    if (!take || take.endedAt) return;
    take.endedAt = endedAt;
    take.lastSeq = lastSeq;
    take.updatedAt = this.clock.iso();
  }
}

/** Object storage with `upsert: false` semantics and signed-upload stand-ins. */
export class FakeRecordingStorage implements RecordingStorage {
  objects = new Map<string, Uint8Array>();
  failList = false;
  failUploadUrls = false;
  removed: string[] = [];

  key(bucket: string, path: string) {
    return `${bucket}::${path}`;
  }

  async createUploadUrl(bucket: string, path: string) {
    if (this.failUploadUrls) return null;
    return `https://storage.test/upload/${encodeURIComponent(bucket)}/${encodeURIComponent(path)}?token=fake`;
  }

  /** What the relay does with an upload URL. Refuses an overwrite. */
  put(uploadUrl: string, bytes: Uint8Array): "created" | "exists" {
    const match = /^https:\/\/storage\.test\/upload\/([^/]+)\/([^?]+)\?/.exec(uploadUrl);
    if (!match) throw new Error("not an upload url");
    const key = this.key(decodeURIComponent(match[1]), decodeURIComponent(match[2]));
    if (this.objects.has(key)) return "exists";
    this.objects.set(key, bytes);
    return "created";
  }

  async list(bucket: string, folder: string) {
    if (this.failList) return null;
    const prefix = this.key(bucket, folder.replace(/\/$/, "") + "/");
    return [...this.objects.entries()]
      .filter(([key]) => key.startsWith(prefix) && !key.slice(prefix.length).includes("/"))
      .map(([key, bytes]) => ({ name: key.slice(prefix.length), size: bytes.length }));
  }

  async download(bucket: string, path: string) {
    return this.objects.get(this.key(bucket, path)) ?? null;
  }

  async remove(bucket: string, paths: string[]) {
    for (const path of paths) {
      this.objects.delete(this.key(bucket, path));
      this.removed.push(this.key(bucket, path));
    }
    return true;
  }

  publicUrl(bucket: string, path: string) {
    return `https://storage.test/public/${bucket}/${path}`;
  }
}
