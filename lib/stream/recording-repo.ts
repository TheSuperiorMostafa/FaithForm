import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import type { SessionWindow } from "@/lib/stream/recording-model";

/**
 * The recording lifecycle's view of the database and of storage.
 *
 * Deliberately narrow. The lifecycle (`recording-lifecycle.ts`) makes every
 * decision; this layer only reads and writes rows, and every write is keyed by
 * a natural identity (church + take id, take + sequence, session) so that
 * repeating it is harmless.
 *
 * Two implementations exist: the Supabase one below, used in production, and
 * an in-memory one in `tests/support/recording-fakes.ts` with the same
 * uniqueness semantics, which lets the lifecycle be exercised end to end —
 * duplicate webhooks, out-of-order delivery, reconnects, missed callbacks —
 * without a provider or a database.
 */

export type RecordingStatus =
  | "recording"
  | "processing"
  | "ready"
  | "published"
  | "failed"
  | "deleted";

export type RecordingRecord = {
  id: string;
  churchId: string;
  streamSessionId: string | null;
  streamEventId: string | null;
  title: string | null;
  status: RecordingStatus;
  sourceKind: "file" | "segments";
  storagePath: string;
  durationSec: number | null;
  trimStartSec: number;
  trimEndSec: number | null;
  segmentCount: number;
  totalBytes: number;
  recordingStartedAt: string | null;
  recordingEndedAt: string | null;
  lastSegmentAt: string | null;
  processingStartedAt: string | null;
  readyAt: string | null;
  failedAt: string | null;
  failureReason: string | null;
  failureDetail: string | null;
  finalizedBy: string | null;
  autoPosterUrl: string | null;
  mobilePlayable: boolean;
  renditionReason: string | null;
  renditionVerifiedAt: string | null;
  renditionRevision: number;
  renditionObjectHash: string | null;
  mobileVisibility: "none" | "public" | "followers" | "members";
  mobilePublishedAt: string | null;
  mobileUnpublishedAt: string | null;
  mobilePosterUrl: string | null;
  mobileSummary: string | null;
  webPublishedAt: string | null;
  webUnpublishedAt: string | null;
  seriesId: string | null;
  speakerTags: string[];
  deletedAt: string | null;
  purgedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type RecordingPatch = Partial<
  Pick<
    RecordingRecord,
    | "status"
    | "title"
    | "durationSec"
    | "trimStartSec"
    | "trimEndSec"
    | "processingStartedAt"
    | "readyAt"
    | "failedAt"
    | "failureReason"
    | "failureDetail"
    | "finalizedBy"
    | "autoPosterUrl"
    | "purgedAt"
    | "streamEventId"
  >
>;

export type TakeRecord = {
  id: string;
  churchId: string;
  relayTakeId: string;
  startedAt: string | null;
  endedAt: string | null;
  lastSeq: number | null;
  highestSeenSeq: number | null;
  highestSeenStart: string | null;
  initStoragePath: string | null;
  initStatus: "none" | "pending_upload" | "uploaded";
  initBytes: number | null;
  updatedAt: string;
};

export type TakePatch = {
  startedAt?: string | null;
  endedAt?: string | null;
  lastSeq?: number | null;
  /** Raises the high-water mark; never lowers it. */
  seen?: { seq: number; startedAt: string };
};

export type SegmentRecord = {
  id: string;
  churchId: string;
  recordingId: string;
  takeId: string;
  seq: number;
  startedAt: string;
  durationSec: number;
  byteSize: number | null;
  storagePath: string;
  status: "pending_upload" | "uploaded";
  uploadedAt: string | null;
  createdAt: string;
};

export type FrameRecord = {
  id: string;
  churchId: string;
  recordingId: string;
  takeId: string;
  seq: number;
  capturedAt: string;
  storagePath: string;
  publicUrl: string;
  status: "pending_upload" | "uploaded";
};

export type IngestStatusRecord = {
  churchId: string;
  publishing: boolean;
  relayTakeId: string | null;
  recorderRunning: boolean;
  recorderVersion: string | null;
  lastSegmentClosedAt: string | null;
  pendingUploads: number;
  bitrateKbps: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  reconnects: number;
  heartbeatAt: string;
};

export type RecordingSettings = {
  autoPublish: boolean;
  defaultVisibility: "public" | "followers" | "members";
  defaultSeriesId: string | null;
  publishToWebsite: boolean;
  notifyOnLive: boolean;
  notifyOnPublish: boolean;
};

export const DEFAULT_RECORDING_SETTINGS: RecordingSettings = {
  autoPublish: false,
  defaultVisibility: "public",
  defaultSeriesId: null,
  publishToWebsite: true,
  notifyOnLive: false,
  notifyOnPublish: false,
};

export type ChurchSummary = { id: string; slug: string | null; name: string; timezone: string };

export type EventSummary = {
  id: string;
  title: string;
  status: string;
  mobileVisibility: string;
  artworkUrl: string | null;
};

export type RenditionWrite = {
  churchId: string;
  recordingId: string;
  playable: boolean;
  kind: "hls" | "progressive" | null;
  reason: string;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  videoProfile: string | null;
  audioProfile: string | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
  objectSize: number | null;
  objectHash: string | null;
};

export interface RecordingRepo {
  getChurch(churchId: string): Promise<ChurchSummary | null>;
  /**
   * Whether this church has streaming configured at all. The relay names a
   * church by the MediaMTX path it published to; this is the trusted mapping
   * that path is checked against before anything is written for it.
   */
  churchHasStreamIngest(churchId: string): Promise<boolean>;
  getEvent(churchId: string, eventId: string): Promise<EventSummary | null>;
  getSettings(churchId: string): Promise<RecordingSettings>;

  getSession(churchId: string, sessionId: string): Promise<SessionWindow | null>;
  /** Sessions whose window could contain any instant in [from, to]. */
  listSessionsInRange(churchId: string, from: string, to: string): Promise<SessionWindow[]>;
  /** Live or waiting sessions across every church, for the reconciler. */
  listOpenSessions(limit: number): Promise<SessionWindow[]>;

  getRecording(churchId: string, recordingId: string): Promise<RecordingRecord | null>;
  getRecordingForSession(churchId: string, sessionId: string): Promise<RecordingRecord | null>;
  /** Inserts, or returns the row a concurrent caller already inserted. */
  createSegmentsRecording(input: {
    id: string;
    churchId: string;
    sessionId: string;
    eventId: string | null;
    title: string;
    storagePath: string;
  }): Promise<RecordingRecord>;
  updateRecording(churchId: string, recordingId: string, patch: RecordingPatch): Promise<void>;
  /** Recordings in any of these states across every church, oldest update first. */
  listRecordingsByStatus(statuses: RecordingStatus[], limit: number): Promise<RecordingRecord[]>;
  listRecordingsAwaitingPurge(limit: number): Promise<RecordingRecord[]>;
  refreshRecordingStats(churchId: string, recordingId: string): Promise<void>;
  /** The only way `mobile_playable` is written. Increments the verdict revision. */
  recordRendition(input: RenditionWrite): Promise<{ ok: boolean; playable: boolean; revision: number }>;

  upsertTake(churchId: string, relayTakeId: string, patch: TakePatch): Promise<TakeRecord>;
  getTake(churchId: string, relayTakeId: string): Promise<TakeRecord | null>;
  listTakesByIds(ids: string[]): Promise<TakeRecord[]>;
  listTakesInRange(churchId: string, from: string, to: string): Promise<TakeRecord[]>;
  setTakeInit(
    takeId: string,
    patch: { storagePath?: string; status: TakeRecord["initStatus"]; bytes?: number | null },
  ): Promise<void>;

  getSegments(takeId: string, seqs: number[]): Promise<SegmentRecord[]>;
  /** Inserts, or returns the row already there for (take, seq). */
  insertSegment(row: Omit<SegmentRecord, "id" | "createdAt" | "uploadedAt" | "status">): Promise<SegmentRecord>;
  markSegmentsUploaded(
    takeId: string,
    items: Array<{ seq: number; bytes: number | null }>,
    at: string,
  ): Promise<SegmentRecord[]>;
  listSegments(recordingId: string): Promise<SegmentRecord[]>;
  listStalePendingSegments(olderThan: string, limit: number): Promise<SegmentRecord[]>;
  deleteSegments(ids: string[]): Promise<void>;

  getFrames(takeId: string, seqs: number[]): Promise<FrameRecord[]>;
  insertFrame(row: Omit<FrameRecord, "id" | "status">): Promise<FrameRecord>;
  markFramesUploaded(takeId: string, seqs: number[]): Promise<FrameRecord[]>;
  listFrames(recordingId: string): Promise<FrameRecord[]>;

  upsertIngestStatus(churchId: string, patch: Omit<IngestStatusRecord, "churchId">): Promise<void>;
  getIngestStatus(churchId: string): Promise<IngestStatusRecord | null>;

  pruneNonces(olderThan: string): Promise<void>;
  /** Takes the relay never closed and has not touched since [olderThan]. */
  listStaleOpenTakes(olderThan: string, limit: number): Promise<TakeRecord[]>;
  closeTake(takeId: string, endedAt: string, lastSeq: number | null): Promise<void>;
}

/** What the lifecycle needs from object storage. */
export interface RecordingStorage {
  createUploadUrl(bucket: string, path: string): Promise<string | null>;
  /** Objects directly under a folder, with sizes. */
  list(bucket: string, folder: string): Promise<Array<{ name: string; size: number | null }> | null>;
  download(bucket: string, path: string): Promise<Uint8Array | null>;
  remove(bucket: string, paths: string[]): Promise<boolean>;
  publicUrl(bucket: string, path: string): string;
}

// ---------------------------------------------------------------------------
// Supabase implementation
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

const num = (value: unknown): number | null =>
  value === null || value === undefined ? null : Number(value);

function mapRecording(row: Row): RecordingRecord {
  return {
    id: row.id as string,
    churchId: row.church_id as string,
    streamSessionId: (row.stream_session_id as string | null) ?? null,
    streamEventId: (row.stream_event_id as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    status: row.status as RecordingStatus,
    sourceKind: ((row.source_kind as string | null) ?? "file") as RecordingRecord["sourceKind"],
    storagePath: row.storage_path as string,
    durationSec: num(row.duration_sec),
    trimStartSec: Number(row.trim_start_sec ?? 0),
    trimEndSec: num(row.trim_end_sec),
    segmentCount: Number(row.segment_count ?? 0),
    totalBytes: Number(row.total_bytes ?? 0),
    recordingStartedAt: (row.recording_started_at as string | null) ?? null,
    recordingEndedAt: (row.recording_ended_at as string | null) ?? null,
    lastSegmentAt: (row.last_segment_at as string | null) ?? null,
    processingStartedAt: (row.processing_started_at as string | null) ?? null,
    readyAt: (row.ready_at as string | null) ?? null,
    failedAt: (row.failed_at as string | null) ?? null,
    failureReason: (row.failure_reason as string | null) ?? null,
    failureDetail: (row.failure_detail as string | null) ?? null,
    finalizedBy: (row.finalized_by as string | null) ?? null,
    autoPosterUrl: (row.auto_poster_url as string | null) ?? null,
    mobilePlayable: Boolean(row.mobile_playable),
    renditionReason: (row.mobile_rendition_reason as string | null) ?? null,
    renditionVerifiedAt: (row.mobile_rendition_verified_at as string | null) ?? null,
    renditionRevision: Number(row.mobile_rendition_revision ?? 0),
    renditionObjectHash: (row.mobile_rendition_object_hash as string | null) ?? null,
    mobileVisibility: ((row.mobile_visibility as string | null) ?? "none") as RecordingRecord["mobileVisibility"],
    mobilePublishedAt: (row.mobile_published_at as string | null) ?? null,
    mobileUnpublishedAt: (row.mobile_unpublished_at as string | null) ?? null,
    mobilePosterUrl: (row.mobile_poster_url as string | null) ?? null,
    mobileSummary: (row.mobile_summary as string | null) ?? null,
    webPublishedAt: (row.web_published_at as string | null) ?? null,
    webUnpublishedAt: (row.web_unpublished_at as string | null) ?? null,
    seriesId: (row.series_id as string | null) ?? null,
    speakerTags: (row.speaker_tags as string[] | null) ?? [],
    deletedAt: (row.deleted_at as string | null) ?? null,
    purgedAt: (row.purged_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string | null) ?? (row.created_at as string),
  };
}

function mapSession(row: Row): SessionWindow {
  return {
    id: row.id as string,
    churchId: row.church_id as string,
    streamEventId: (row.stream_event_id as string | null) ?? null,
    title: (row.title as string | null) ?? null,
    createdAt: row.created_at as string,
    endedAt: (row.ended_at as string | null) ?? null,
    status: row.status as SessionWindow["status"],
  };
}

function mapTake(row: Row): TakeRecord {
  return {
    id: row.id as string,
    churchId: row.church_id as string,
    relayTakeId: row.relay_take_id as string,
    startedAt: (row.started_at as string | null) ?? null,
    endedAt: (row.ended_at as string | null) ?? null,
    lastSeq: num(row.last_seq),
    highestSeenSeq: num(row.highest_seen_seq),
    highestSeenStart: (row.highest_seen_start as string | null) ?? null,
    initStoragePath: (row.init_storage_path as string | null) ?? null,
    initStatus: ((row.init_status as string | null) ?? "none") as TakeRecord["initStatus"],
    initBytes: num(row.init_bytes),
    updatedAt: row.updated_at as string,
  };
}

function mapSegment(row: Row): SegmentRecord {
  return {
    id: row.id as string,
    churchId: row.church_id as string,
    recordingId: row.recording_id as string,
    takeId: row.take_id as string,
    seq: Number(row.seq),
    startedAt: row.started_at as string,
    durationSec: Number(row.duration_sec),
    byteSize: num(row.byte_size),
    storagePath: row.storage_path as string,
    status: row.status as SegmentRecord["status"],
    uploadedAt: (row.uploaded_at as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function mapFrame(row: Row): FrameRecord {
  return {
    id: row.id as string,
    churchId: row.church_id as string,
    recordingId: row.recording_id as string,
    takeId: row.take_id as string,
    seq: Number(row.seq),
    capturedAt: row.captured_at as string,
    storagePath: row.storage_path as string,
    publicUrl: row.public_url as string,
    status: row.status as FrameRecord["status"],
  };
}

const RECORDING_PATCH_COLUMNS: Record<keyof RecordingPatch, string> = {
  status: "status",
  title: "title",
  durationSec: "duration_sec",
  trimStartSec: "trim_start_sec",
  trimEndSec: "trim_end_sec",
  processingStartedAt: "processing_started_at",
  readyAt: "ready_at",
  failedAt: "failed_at",
  failureReason: "failure_reason",
  failureDetail: "failure_detail",
  finalizedBy: "finalized_by",
  autoPosterUrl: "auto_poster_url",
  purgedAt: "purged_at",
  streamEventId: "stream_event_id",
};

function assertOk(error: { message: string } | null, what: string): void {
  if (error) throw new Error(`${what}: ${error.message}`);
}

const isUniqueViolation = (error: { code?: string; message?: string } | null) =>
  Boolean(error && (error.code === "23505" || /duplicate key/i.test(error.message ?? "")));

/**
 * Per instance, positive and negative. A church turning streaming on is picked
 * up within five minutes; the relay retries anything refused meanwhile.
 */
const ingestMappingCache = new Map<string, { value: boolean; expires: number }>();

export function createSupabaseRecordingRepo(client?: SupabaseClient): RecordingRepo {
  const db = client ?? createAdminClient();

  return {
    async getChurch(churchId) {
      const { data } = await db
        .from("churches")
        .select("id, slug, name, timezone")
        .eq("id", churchId)
        .maybeSingle();
      if (!data) return null;
      return {
        id: data.id as string,
        slug: (data.slug as string | null) ?? null,
        name: (data.name as string) ?? "",
        timezone: (data.timezone as string | null) ?? "America/New_York",
      };
    },

    async churchHasStreamIngest(churchId) {
      const cached = ingestMappingCache.get(churchId);
      if (cached !== undefined && cached.expires > Date.now()) return cached.value;
      const { data } = await db
        .from("church_integrations")
        .select("access_token")
        .eq("church_id", churchId)
        .eq("provider", "stream")
        .maybeSingle();
      const value = Boolean((data?.access_token as string | null)?.trim());
      ingestMappingCache.set(churchId, { value, expires: Date.now() + 5 * 60_000 });
      return value;
    },

    async getEvent(churchId, eventId) {
      const { data } = await db
        .from("stream_events")
        .select("id, title, status, mobile_visibility, artwork_url")
        .eq("id", eventId)
        .eq("church_id", churchId)
        .maybeSingle();
      if (!data) return null;
      return {
        id: data.id as string,
        title: (data.title as string) ?? "",
        status: data.status as string,
        mobileVisibility: (data.mobile_visibility as string) ?? "none",
        artworkUrl: (data.artwork_url as string | null) ?? null,
      };
    },

    async getSettings(churchId) {
      const { data } = await db
        .from("stream_recording_settings")
        .select("*")
        .eq("church_id", churchId)
        .maybeSingle();
      if (!data) return { ...DEFAULT_RECORDING_SETTINGS };
      return {
        autoPublish: Boolean(data.auto_publish),
        defaultVisibility: (data.default_visibility as RecordingSettings["defaultVisibility"]) ?? "public",
        defaultSeriesId: (data.default_series_id as string | null) ?? null,
        publishToWebsite: data.publish_to_website !== false,
        notifyOnLive: Boolean(data.notify_on_live),
        notifyOnPublish: Boolean(data.notify_on_publish),
      };
    },

    async getSession(churchId, sessionId) {
      const { data } = await db
        .from("stream_sessions")
        .select("id, church_id, stream_event_id, title, created_at, ended_at, status")
        .eq("id", sessionId)
        .eq("church_id", churchId)
        .maybeSingle();
      return data ? mapSession(data) : null;
    },

    async listSessionsInRange(churchId, from, to) {
      const { data, error } = await db
        .from("stream_sessions")
        .select("id, church_id, stream_event_id, title, created_at, ended_at, status")
        .eq("church_id", churchId)
        .lte("created_at", to)
        .or(`ended_at.is.null,ended_at.gte.${from}`)
        .order("created_at", { ascending: false })
        .limit(20);
      assertOk(error, "listSessionsInRange");
      return (data ?? []).map(mapSession);
    },

    async listOpenSessions(limit) {
      const { data, error } = await db
        .from("stream_sessions")
        .select("id, church_id, stream_event_id, title, created_at, ended_at, status")
        .in("status", ["preparing", "waiting_for_encoder", "live"])
        .order("created_at", { ascending: true })
        .limit(limit);
      assertOk(error, "listOpenSessions");
      return (data ?? []).map(mapSession);
    },

    async getRecording(churchId, recordingId) {
      const { data } = await db
        .from("stream_recordings")
        .select("*")
        .eq("id", recordingId)
        .eq("church_id", churchId)
        .maybeSingle();
      return data ? mapRecording(data) : null;
    },

    async getRecordingForSession(churchId, sessionId) {
      const { data } = await db
        .from("stream_recordings")
        .select("*")
        .eq("church_id", churchId)
        .eq("stream_session_id", sessionId)
        .eq("source_kind", "segments")
        .maybeSingle();
      return data ? mapRecording(data) : null;
    },

    async createSegmentsRecording(input) {
      const { data, error } = await db
        .from("stream_recordings")
        .insert({
          id: input.id,
          church_id: input.churchId,
          stream_session_id: input.sessionId,
          stream_event_id: input.eventId,
          title: input.title,
          storage_path: input.storagePath,
          source_kind: "segments",
          status: "recording",
          // Nothing is visible anywhere until someone (or the church's
          // auto-publish setting) publishes it.
          mobile_visibility: "none",
        })
        .select("*")
        .single();
      if (data) return mapRecording(data);
      if (isUniqueViolation(error)) {
        const existing = await this.getRecordingForSession(input.churchId, input.sessionId);
        if (existing) return existing;
      }
      throw new Error(`createSegmentsRecording: ${error?.message ?? "no row"}`);
    },

    async updateRecording(churchId, recordingId, patch) {
      const updates: Row = {};
      for (const [key, column] of Object.entries(RECORDING_PATCH_COLUMNS)) {
        const value = patch[key as keyof RecordingPatch];
        if (value !== undefined) updates[column] = value;
      }
      if (Object.keys(updates).length === 0) return;
      const { error } = await db
        .from("stream_recordings")
        .update(updates)
        .eq("id", recordingId)
        .eq("church_id", churchId);
      assertOk(error, "updateRecording");
    },

    async listRecordingsByStatus(statuses, limit) {
      const { data, error } = await db
        .from("stream_recordings")
        .select("*")
        .in("status", statuses)
        .is("deleted_at", null)
        .order("updated_at", { ascending: true })
        .limit(limit);
      assertOk(error, "listRecordingsByStatus");
      return (data ?? []).map(mapRecording);
    },

    async listRecordingsAwaitingPurge(limit) {
      const { data, error } = await db
        .from("stream_recordings")
        .select("*")
        .not("deleted_at", "is", null)
        .is("purged_at", null)
        .order("deleted_at", { ascending: true })
        .limit(limit);
      assertOk(error, "listRecordingsAwaitingPurge");
      return (data ?? []).map(mapRecording);
    },

    async refreshRecordingStats(churchId, recordingId) {
      const { error } = await db.rpc("refresh_recording_segment_stats", {
        p_recording_id: recordingId,
        p_church_id: churchId,
      });
      assertOk(error, "refreshRecordingStats");
    },

    async recordRendition(input) {
      const { data, error } = await db.rpc("record_recording_rendition", {
        p_recording_id: input.recordingId,
        p_church_id: input.churchId,
        p_playable: input.playable,
        p_kind: input.playable ? input.kind : null,
        p_reason: input.reason,
        p_container: input.container,
        p_video_codec: input.videoCodec,
        p_audio_codec: input.audioCodec,
        p_video_profile: input.videoProfile,
        p_audio_profile: input.audioProfile,
        p_audio_sample_rate: input.audioSampleRate,
        p_audio_channels: input.audioChannels,
        p_object_size: input.objectSize,
        p_object_etag: null,
        p_object_version: null,
        p_object_hash: input.objectHash,
      });
      assertOk(error, "recordRendition");
      const row = ((data ?? []) as Row[])[0];
      return {
        ok: Boolean(row?.ok),
        playable: Boolean(row?.playable),
        revision: Number(row?.revision ?? 0),
      };
    },

    async upsertTake(churchId, relayTakeId, patch) {
      // Create-if-missing first, so every caller below works on a row that
      // exists. A concurrent creator loses the race harmlessly.
      const { error: insertError } = await db
        .from("stream_recording_takes")
        .insert({
          church_id: churchId,
          relay_take_id: relayTakeId,
          started_at: patch.startedAt ?? null,
        });
      if (insertError && !isUniqueViolation(insertError)) {
        throw new Error(`upsertTake: ${insertError.message}`);
      }

      const current = await this.getTake(churchId, relayTakeId);
      if (!current) throw new Error("upsertTake: take vanished");

      const updates: Row = {};
      if (patch.startedAt && !current.startedAt) updates.started_at = patch.startedAt;
      if (patch.endedAt !== undefined && patch.endedAt !== null && !current.endedAt) {
        updates.ended_at = patch.endedAt;
      }
      if (patch.lastSeq !== undefined && patch.lastSeq !== null) updates.last_seq = patch.lastSeq;
      if (patch.seen && (current.highestSeenSeq === null || patch.seen.seq > current.highestSeenSeq)) {
        updates.highest_seen_seq = patch.seen.seq;
        updates.highest_seen_start = patch.seen.startedAt;
      }
      if (Object.keys(updates).length === 0) return current;

      let query = db.from("stream_recording_takes").update(updates).eq("id", current.id);
      // Compare-and-set on the high-water mark, so two concurrent batches can
      // only ever raise it.
      if (updates.highest_seen_seq !== undefined) {
        query =
          current.highestSeenSeq === null
            ? query.is("highest_seen_seq", null)
            : query.eq("highest_seen_seq", current.highestSeenSeq);
      }
      const { data, error } = await query.select("*");
      assertOk(error, "upsertTake");
      if (data && data.length > 0) return mapTake(data[0]);
      // Lost the race on the high-water mark: retry once with fresh state.
      return this.upsertTake(churchId, relayTakeId, patch);
    },

    async getTake(churchId, relayTakeId) {
      const { data } = await db
        .from("stream_recording_takes")
        .select("*")
        .eq("church_id", churchId)
        .eq("relay_take_id", relayTakeId)
        .maybeSingle();
      return data ? mapTake(data) : null;
    },

    async listTakesByIds(ids) {
      if (ids.length === 0) return [];
      const { data, error } = await db.from("stream_recording_takes").select("*").in("id", ids);
      assertOk(error, "listTakesByIds");
      return (data ?? []).map(mapTake);
    },

    async listTakesInRange(churchId, from, to) {
      const { data, error } = await db
        .from("stream_recording_takes")
        .select("*")
        .eq("church_id", churchId)
        .or(`ended_at.is.null,ended_at.gte.${from}`)
        .order("created_at", { ascending: false })
        .limit(200);
      assertOk(error, "listTakesInRange");
      const until = Date.parse(to);
      return (data ?? [])
        .map(mapTake)
        .filter((take) => take.startedAt === null || Date.parse(take.startedAt) <= until);
    },

    async setTakeInit(takeId, patch) {
      const updates: Row = { init_status: patch.status };
      if (patch.storagePath) updates.init_storage_path = patch.storagePath;
      if (patch.bytes !== undefined) updates.init_bytes = patch.bytes;
      if (patch.status === "uploaded") updates.init_uploaded_at = new Date().toISOString();
      const { error } = await db.from("stream_recording_takes").update(updates).eq("id", takeId);
      assertOk(error, "setTakeInit");
    },

    async getSegments(takeId, seqs) {
      if (seqs.length === 0) return [];
      const { data, error } = await db
        .from("stream_recording_segments")
        .select("*")
        .eq("take_id", takeId)
        .in("seq", seqs);
      assertOk(error, "getSegments");
      return (data ?? []).map(mapSegment);
    },

    async insertSegment(row) {
      const { data, error } = await db
        .from("stream_recording_segments")
        .insert({
          church_id: row.churchId,
          recording_id: row.recordingId,
          take_id: row.takeId,
          seq: row.seq,
          started_at: row.startedAt,
          duration_sec: row.durationSec,
          byte_size: row.byteSize,
          storage_path: row.storagePath,
        })
        .select("*")
        .single();
      if (data) return mapSegment(data);
      if (isUniqueViolation(error)) {
        const [existing] = await this.getSegments(row.takeId, [row.seq]);
        if (existing) return existing;
      }
      throw new Error(`insertSegment: ${error?.message ?? "no row"}`);
    },

    async markSegmentsUploaded(takeId, items, at) {
      const updated: SegmentRecord[] = [];
      for (const item of items) {
        const updates: Row = { status: "uploaded", uploaded_at: at };
        if (item.bytes !== null && item.bytes > 0) updates.byte_size = item.bytes;
        const { data, error } = await db
          .from("stream_recording_segments")
          .update(updates)
          .eq("take_id", takeId)
          .eq("seq", item.seq)
          .eq("status", "pending_upload")
          .select("*");
        assertOk(error, "markSegmentsUploaded");
        for (const row of data ?? []) updated.push(mapSegment(row));
      }
      return updated;
    },

    async listSegments(recordingId) {
      const rows: Row[] = [];
      // Paged: a four-hour service is ~2,400 segments and PostgREST caps a
      // response at 1,000 rows.
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db
          .from("stream_recording_segments")
          .select("*")
          .eq("recording_id", recordingId)
          .order("started_at", { ascending: true })
          .order("seq", { ascending: true })
          .range(offset, offset + 999);
        assertOk(error, "listSegments");
        rows.push(...(data ?? []));
        if (!data || data.length < 1000) break;
      }
      return rows.map(mapSegment);
    },

    async listStalePendingSegments(olderThan, limit) {
      const { data, error } = await db
        .from("stream_recording_segments")
        .select("*")
        .eq("status", "pending_upload")
        .lt("created_at", olderThan)
        .order("created_at", { ascending: true })
        .limit(limit);
      assertOk(error, "listStalePendingSegments");
      return (data ?? []).map(mapSegment);
    },

    async deleteSegments(ids) {
      if (ids.length === 0) return;
      const { error } = await db.from("stream_recording_segments").delete().in("id", ids);
      assertOk(error, "deleteSegments");
    },

    async getFrames(takeId, seqs) {
      if (seqs.length === 0) return [];
      const { data, error } = await db
        .from("stream_recording_frames")
        .select("*")
        .eq("take_id", takeId)
        .in("seq", seqs);
      assertOk(error, "getFrames");
      return (data ?? []).map(mapFrame);
    },

    async insertFrame(row) {
      const { data, error } = await db
        .from("stream_recording_frames")
        .insert({
          church_id: row.churchId,
          recording_id: row.recordingId,
          take_id: row.takeId,
          seq: row.seq,
          captured_at: row.capturedAt,
          storage_path: row.storagePath,
          public_url: row.publicUrl,
        })
        .select("*")
        .single();
      if (data) return mapFrame(data);
      if (isUniqueViolation(error)) {
        const [existing] = await this.getFrames(row.takeId, [row.seq]);
        if (existing) return existing;
      }
      throw new Error(`insertFrame: ${error?.message ?? "no row"}`);
    },

    async markFramesUploaded(takeId, seqs) {
      if (seqs.length === 0) return [];
      const { data, error } = await db
        .from("stream_recording_frames")
        .update({ status: "uploaded" })
        .eq("take_id", takeId)
        .in("seq", seqs)
        .select("*");
      assertOk(error, "markFramesUploaded");
      return (data ?? []).map(mapFrame);
    },

    async listFrames(recordingId) {
      const { data, error } = await db
        .from("stream_recording_frames")
        .select("*")
        .eq("recording_id", recordingId)
        .eq("status", "uploaded")
        .order("captured_at", { ascending: true })
        .limit(200);
      assertOk(error, "listFrames");
      return (data ?? []).map(mapFrame);
    },

    async upsertIngestStatus(churchId, patch) {
      const { error } = await db.from("stream_ingest_status").upsert(
        {
          church_id: churchId,
          publishing: patch.publishing,
          relay_take_id: patch.relayTakeId,
          recorder_running: patch.recorderRunning,
          recorder_version: patch.recorderVersion,
          last_segment_closed_at: patch.lastSegmentClosedAt,
          pending_uploads: patch.pendingUploads,
          bitrate_kbps: patch.bitrateKbps,
          width: patch.width,
          height: patch.height,
          fps: patch.fps,
          video_codec: patch.videoCodec,
          audio_codec: patch.audioCodec,
          reconnects: patch.reconnects,
          heartbeat_at: patch.heartbeatAt,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "church_id" },
      );
      assertOk(error, "upsertIngestStatus");
    },

    async getIngestStatus(churchId) {
      const { data } = await db
        .from("stream_ingest_status")
        .select("*")
        .eq("church_id", churchId)
        .maybeSingle();
      if (!data) return null;
      return {
        churchId,
        publishing: Boolean(data.publishing),
        relayTakeId: (data.relay_take_id as string | null) ?? null,
        recorderRunning: Boolean(data.recorder_running),
        recorderVersion: (data.recorder_version as string | null) ?? null,
        lastSegmentClosedAt: (data.last_segment_closed_at as string | null) ?? null,
        pendingUploads: Number(data.pending_uploads ?? 0),
        bitrateKbps: num(data.bitrate_kbps),
        width: num(data.width),
        height: num(data.height),
        fps: num(data.fps),
        videoCodec: (data.video_codec as string | null) ?? null,
        audioCodec: (data.audio_codec as string | null) ?? null,
        reconnects: Number(data.reconnects ?? 0),
        heartbeatAt: data.heartbeat_at as string,
      };
    },

    async pruneNonces(olderThan) {
      await db.from("stream_relay_webhook_nonces").delete().lt("received_at", olderThan);
    },

    async listStaleOpenTakes(olderThan, limit) {
      const { data, error } = await db
        .from("stream_recording_takes")
        .select("*")
        .is("ended_at", null)
        .lt("updated_at", olderThan)
        .order("updated_at", { ascending: true })
        .limit(limit);
      assertOk(error, "listStaleOpenTakes");
      return (data ?? []).map(mapTake);
    },

    async closeTake(takeId, endedAt, lastSeq) {
      const { error } = await db
        .from("stream_recording_takes")
        .update({ ended_at: endedAt, last_seq: lastSeq })
        .eq("id", takeId)
        .is("ended_at", null);
      assertOk(error, "closeTake");
    },
  };
}

/** Records a relay nonce; false when it was already used. */
export async function recordRelayNonce(
  input: { nonce: string; route: string },
  client?: SupabaseClient,
): Promise<boolean> {
  const db = client ?? createAdminClient();
  const { error } = await db
    .from("stream_relay_webhook_nonces")
    .insert({ nonce: input.nonce, route: input.route.slice(0, 80) });
  if (!error) return true;
  if (isUniqueViolation(error)) return false;
  // The ledger being unreachable is not a replay. Refusing here would take
  // recording offline whenever one table is slow; the signature and timestamp
  // still hold.
  console.error("[relay] nonce ledger unavailable");
  return true;
}

export function createSupabaseRecordingStorage(client?: SupabaseClient): RecordingStorage {
  const db = client ?? createAdminClient();
  return {
    async createUploadUrl(bucket, path) {
      // Never upsert: a segment is immutable once written, which is what lets
      // FaithForm serve it without re-verifying its bytes on every request.
      const { data, error } = await db.storage.from(bucket).createSignedUploadUrl(path, { upsert: false });
      if (error || !data?.signedUrl) return null;
      return data.signedUrl;
    },

    async list(bucket, folder) {
      const results: Array<{ name: string; size: number | null }> = [];
      for (let offset = 0; ; offset += 1000) {
        const { data, error } = await db.storage
          .from(bucket)
          .list(folder.replace(/\/$/, ""), { limit: 1000, offset });
        if (error) return null;
        for (const item of data ?? []) {
          const size = (item.metadata as { size?: number } | null)?.size;
          results.push({ name: item.name, size: typeof size === "number" ? size : null });
        }
        if (!data || data.length < 1000) break;
      }
      return results;
    },

    async download(bucket, path) {
      const { data, error } = await db.storage.from(bucket).download(path);
      if (error || !data) return null;
      return new Uint8Array(await data.arrayBuffer());
    },

    async remove(bucket, paths) {
      for (let index = 0; index < paths.length; index += 500) {
        const { error } = await db.storage.from(bucket).remove(paths.slice(index, index + 500));
        if (error) return false;
      }
      return true;
    },

    publicUrl(bucket, path) {
      return db.storage.from(bucket).getPublicUrl(path).data.publicUrl;
    },
  };
}
