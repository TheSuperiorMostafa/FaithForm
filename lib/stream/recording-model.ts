/**
 * The pure rules of the livestream recording lifecycle.
 *
 * Nothing in this file reads a database, a clock it was not handed, or the
 * network. Every decision the lifecycle makes — which broadcast a segment
 * belongs to, whether a recording is complete, what a VOD playlist contains,
 * what a church is told — is a function here, so the same rule serves the
 * relay routes, the reconciler and the dashboard, and is tested once.
 *
 * See docs/faithform/P15_LIVESTREAM_RECORDING_LIFECYCLE.md.
 */

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** What the relay is configured to cut. Segments are cut on keyframes, so ±. */
export const SEGMENT_TARGET_SECONDS = 6;

/**
 * How recent the newest acknowledged segment must be for the dashboard to say
 * "Recording". A segment is six seconds and the relay uploads every few, so a
 * healthy service is typically 10–20 seconds behind; a minute of silence while
 * video is arriving is a real problem, not jitter.
 */
export const RECORDING_CONFIRMED_WINDOW_MS = 60_000;

/** How long after video starts arriving before a missing recording is alarming. */
export const RECORDING_START_GRACE_MS = 45_000;

/** A relay heartbeat older than this says nothing about now. */
export const RELAY_HEARTBEAT_TTL_MS = 60_000;

/**
 * After a broadcast ends, how long to wait for the relay to account for every
 * take before finalizing with what arrived. Long enough for a relay that was
 * briefly unreachable to catch up; short enough that nobody waits all day.
 */
export const FINALIZE_QUIET_MS = 10 * 60_000;
export const FINALIZE_TIMEOUT_MS = 30 * 60_000;

/** A broadcast that ended with no video at all is declared empty after this. */
export const NOTHING_RECORDED_AFTER_MS = 5 * 60_000;

/** A live session with no video for this long is ended by the reconciler. */
export const ABANDONED_SESSION_MS = 60 * 60_000;

/** Seconds a published recording must at least last. Mirrors `publish_recording`. */
export const MIN_PUBLISHABLE_SECONDS = 5;
export const MAX_PUBLISHABLE_SECONDS = 12 * 60 * 60;

// ---------------------------------------------------------------------------
// Attribution: which broadcast does a segment belong to?
// ---------------------------------------------------------------------------

export type SessionWindow = {
  id: string;
  churchId: string;
  streamEventId: string | null;
  title: string | null;
  /** When Go Live was pressed. Recording is part of the broadcast from here. */
  createdAt: string;
  /** When the broadcast ended. Null while it is still on. */
  endedAt: string | null;
  status: "preparing" | "waiting_for_encoder" | "live" | "ended" | "error";
};

export type TimedMedia = { startedAt: string; durationSec: number };

function ms(value: string): number {
  return Date.parse(value);
}

/** Seconds of [media] that fall inside [session]'s window. Zero when disjoint. */
export function overlapSeconds(media: TimedMedia, session: SessionWindow): number {
  const start = ms(media.startedAt);
  const end = start + media.durationSec * 1000;
  const open = ms(session.createdAt);
  const close = session.endedAt ? ms(session.endedAt) : Number.POSITIVE_INFINITY;
  const overlap = Math.min(end, close) - Math.max(start, open);
  return overlap > 0 ? overlap / 1000 : 0;
}

/**
 * The broadcast a segment belongs to, or null when it was recorded outside of
 * any broadcast (preview before Go Live, or the encoder left running after End).
 *
 * Attribution is by the segment's own wall-clock time, never by "whatever is
 * active now" — which is what makes a late, retried or out-of-order upload land
 * in the right recording. When a segment straddles two broadcasts (End then
 * Go Live again inside six seconds) it goes to the one it overlaps most, and a
 * tie goes to the newer broadcast.
 */
export function pickSessionForSegment(
  segment: TimedMedia,
  sessions: SessionWindow[],
): SessionWindow | null {
  let best: SessionWindow | null = null;
  let bestOverlap = 0;
  for (const session of sessions) {
    const overlap = overlapSeconds(segment, session);
    if (overlap <= 0) continue;
    if (
      overlap > bestOverlap ||
      (overlap === bestOverlap && best && ms(session.createdAt) > ms(best.createdAt))
    ) {
      best = session;
      bestOverlap = overlap;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Completeness: has every segment of this broadcast arrived?
// ---------------------------------------------------------------------------

export type TakeProgress = {
  id: string;
  startedAt: string | null;
  endedAt: string | null;
  /** Known once the relay closes the take. */
  lastSeq: number | null;
  highestSeenSeq: number | null;
  highestSeenStart: string | null;
};

/** Whether a take's lifetime could contain any part of the broadcast window. */
export function takeOverlapsWindow(
  take: TakeProgress,
  window: { from: string; to: string },
): boolean {
  const start = take.startedAt ? ms(take.startedAt) : null;
  const end = take.endedAt ? ms(take.endedAt) : null;
  if (start !== null && start >= ms(window.to)) return false;
  if (end !== null && end <= ms(window.from)) return false;
  return true;
}

/**
 * Whether the relay has told us everything a take has for a window ending at
 * [windowEnd].
 *
 * Two ways to know. Either the relay closed the take and we have seen every
 * sequence number up to its last one, or it has already reported a segment
 * that starts after the broadcast ended — and because a take is uploaded in
 * order, everything before that segment has been reported too.
 */
export function takeAccountedFor(take: TakeProgress, windowEnd: string): boolean {
  if (take.endedAt) {
    if (take.lastSeq === null) return true;
    return take.highestSeenSeq !== null && take.highestSeenSeq >= take.lastSeq;
  }
  return take.highestSeenStart !== null && ms(take.highestSeenStart) >= ms(windowEnd);
}

export type CompletenessInput = {
  window: { from: string; to: string };
  takes: TakeProgress[];
  pendingSegments: number;
  pendingInits: number;
};

export type Completeness =
  | { complete: true }
  | { complete: false; waitingFor: "uploads" | "relay" };

export function recordingCompleteness(input: CompletenessInput): Completeness {
  if (input.pendingSegments > 0 || input.pendingInits > 0) {
    return { complete: false, waitingFor: "uploads" };
  }
  const relevant = input.takes.filter((take) => takeOverlapsWindow(take, input.window));
  if (relevant.every((take) => takeAccountedFor(take, input.window.to))) {
    return { complete: true };
  }
  return { complete: false, waitingFor: "relay" };
}

/**
 * What to do with a recording whose broadcast has ended but which is not yet
 * complete. Waiting forever is not an option — a relay that lost its disk will
 * never report — so after a quiet period the recording is finalized with what
 * arrived, or declared empty if nothing did.
 */
export function finalizeDecision(input: {
  broadcastEndedAt: string;
  lastActivityAt: string | null;
  segmentCount: number;
  completeness: Completeness;
  now: number;
}): "finalize" | "timeout" | "empty" | "wait" {
  if (input.completeness.complete) {
    return input.segmentCount > 0 ? "finalize" : "empty";
  }
  const sinceEnd = input.now - ms(input.broadcastEndedAt);
  const lastActivity = input.lastActivityAt ? ms(input.lastActivityAt) : ms(input.broadcastEndedAt);
  const quiet = input.now - lastActivity;

  if (input.segmentCount === 0) {
    return sinceEnd >= NOTHING_RECORDED_AFTER_MS && quiet >= NOTHING_RECORDED_AFTER_MS
      ? "empty"
      : "wait";
  }
  if (sinceEnd >= FINALIZE_TIMEOUT_MS || (sinceEnd >= FINALIZE_QUIET_MS && quiet >= FINALIZE_QUIET_MS)) {
    return "timeout";
  }
  return "wait";
}

// ---------------------------------------------------------------------------
// The VOD playlist
// ---------------------------------------------------------------------------

export type PlaylistSegment = {
  id: string;
  takeId: string;
  seq: number;
  startedAt: string;
  durationSec: number;
};

/** Segments in playback order: by wall clock, then by sequence inside a take. */
export function orderSegments<T extends PlaylistSegment>(segments: T[]): T[] {
  return [...segments].sort((a, b) => {
    const byTime = ms(a.startedAt) - ms(b.startedAt);
    if (byTime !== 0) return byTime;
    if (a.takeId !== b.takeId) return a.takeId < b.takeId ? -1 : 1;
    return a.seq - b.seq;
  });
}

/** Total playable seconds before trimming. */
export function totalDuration(segments: PlaylistSegment[]): number {
  return round3(segments.reduce((sum, segment) => sum + segment.durationSec, 0));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * The segments inside a trim window, on the recording's own timeline (seconds
 * from the first segment, reconnect gaps removed).
 */
export function segmentsInTrim<T extends PlaylistSegment>(
  segments: T[],
  trimStartSec: number,
  trimEndSec: number | null,
): T[] {
  const ordered = orderSegments(segments);
  const kept: T[] = [];
  let position = 0;
  for (const segment of ordered) {
    const start = position;
    const end = position + segment.durationSec;
    position = end;
    if (end <= trimStartSec + 1e-6) continue;
    if (trimEndSec !== null && start >= trimEndSec - 1e-6) continue;
    kept.push(segment);
  }
  return kept;
}

/**
 * A church asks for "start at 3:42, end at 1:04:18". Segments cannot be cut
 * without re-encoding, so the request is widened to the nearest boundaries —
 * never narrowed, so nothing the church wanted kept is lost.
 */
export function snapTrim(
  segments: PlaylistSegment[],
  requestedStartSec: number,
  requestedEndSec: number | null,
): { startSec: number; endSec: number | null; durationSec: number } {
  const ordered = orderSegments(segments);
  const total = totalDuration(ordered);
  const clampedStart = Math.max(0, Math.min(requestedStartSec, total));
  const clampedEnd =
    requestedEndSec === null ? null : Math.max(clampedStart, Math.min(requestedEndSec, total));

  let position = 0;
  let startSec = 0;
  let endSec: number | null = null;
  for (const segment of ordered) {
    const start = position;
    const end = round3(position + segment.durationSec);
    position = end;
    if (start <= clampedStart + 1e-6) startSec = round3(start);
    if (clampedEnd !== null && endSec === null && end >= clampedEnd - 1e-6) endSec = end;
  }
  if (endSec !== null && endSec >= total - 1e-6) endSec = null;
  const effectiveEnd = endSec ?? total;
  return { startSec, endSec, durationSec: round3(Math.max(0, effectiveEnd - startSec)) };
}

/**
 * Builds a VOD media playlist for a segmented recording.
 *
 * * `EXT-X-MAP` whenever the take changes, because each encoder connection has
 *   its own initialization segment;
 * * `EXT-X-DISCONTINUITY` between takes and across any gap inside one, so a
 *   reconnect or a lost segment is a clean jump rather than a decode error;
 * * `ENDLIST` and `PLAYLIST-TYPE:VOD`, so players seek freely and never poll.
 *
 * URIs come from the caller, so the same builder serves the app route, the
 * website route and the dashboard preview, each with its own credential path.
 */
export function buildVodPlaylist(input: {
  segments: PlaylistSegment[];
  trimStartSec: number;
  trimEndSec: number | null;
  initUri: (takeId: string) => string;
  segmentUri: (segment: PlaylistSegment) => string;
}): string {
  const segments = segmentsInTrim(input.segments, input.trimStartSec, input.trimEndSec);
  const target = Math.max(
    1,
    Math.ceil(segments.reduce((max, segment) => Math.max(max, segment.durationSec), 0)),
  );

  const lines = [
    "#EXTM3U",
    "#EXT-X-VERSION:7",
    `#EXT-X-TARGETDURATION:${target}`,
    "#EXT-X-MEDIA-SEQUENCE:0",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    "#EXT-X-INDEPENDENT-SEGMENTS",
  ];

  let previous: PlaylistSegment | null = null;
  for (const segment of segments) {
    const newTake = !previous || previous.takeId !== segment.takeId;
    const gap = previous && !newTake && segment.seq !== previous.seq + 1;
    if (previous && (newTake || gap)) lines.push("#EXT-X-DISCONTINUITY");
    if (newTake) lines.push(`#EXT-X-MAP:URI="${input.initUri(segment.takeId)}"`);
    lines.push(`#EXTINF:${segment.durationSec.toFixed(3)},`);
    lines.push(input.segmentUri(segment));
    previous = segment;
  }

  lines.push("#EXT-X-ENDLIST");
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Storage layout. Derived from ids FaithForm owns — never from the relay.
// ---------------------------------------------------------------------------

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function requireUuid(value: string, label: string): string {
  if (!UUID.test(value)) throw new Error(`Invalid ${label}.`);
  return value.toLowerCase();
}

export function recordingPrefix(churchId: string, recordingId: string): string {
  return `rec/${requireUuid(churchId, "church")}/${requireUuid(recordingId, "recording")}/`;
}

export function segmentStoragePath(
  churchId: string,
  recordingId: string,
  takeId: string,
  seq: number,
): string {
  if (!Number.isInteger(seq) || seq < 0) throw new Error("Invalid segment.");
  return `${recordingPrefix(churchId, recordingId)}${requireUuid(takeId, "take")}/${String(seq).padStart(6, "0")}.m4s`;
}

export function initStoragePath(churchId: string, takeId: string): string {
  return `rec/${requireUuid(churchId, "church")}/takes/${requireUuid(takeId, "take")}/init.mp4`;
}

export function frameStoragePath(
  churchId: string,
  recordingId: string,
  takeId: string,
  seq: number,
  nonce: string,
): string {
  if (!/^[a-z0-9]{6,16}$/.test(nonce)) throw new Error("Invalid frame name.");
  return `recording-frames/${requireUuid(churchId, "church")}/${requireUuid(recordingId, "recording")}/${requireUuid(takeId, "take")}-${seq}-${nonce}.jpg`;
}

// ---------------------------------------------------------------------------
// Default titles
// ---------------------------------------------------------------------------

/**
 * "Sunday Worship – September 20". The date is the church's own, because a
 * service recorded at 11pm Eastern on a Saturday is Saturday's service.
 */
export function defaultRecordingTitle(
  eventTitle: string | null | undefined,
  at: string,
  timeZone: string,
): string {
  const base = (eventTitle ?? "").trim() || "Service";
  let day: string;
  try {
    day = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric", timeZone }).format(
      new Date(at),
    );
  } catch {
    day = new Intl.DateTimeFormat("en-US", { month: "long", day: "numeric" }).format(new Date(at));
  }
  // A title that already names the day is left alone rather than doubled.
  if (base.includes(day)) return base.slice(0, 200);
  return `${base} – ${day}`.slice(0, 200);
}

// ---------------------------------------------------------------------------
// What a church is told
// ---------------------------------------------------------------------------

export type RecordingRowState = {
  status: "recording" | "processing" | "ready" | "published" | "failed" | "deleted";
  sourceKind: "file" | "segments";
  mobilePlayable: boolean;
  renditionReason: string | null;
  renditionVerifiedAt: string | null;
  mobileVisibility: "none" | "public" | "followers" | "members";
  mobilePublishedAt: string | null;
  mobileUnpublishedAt: string | null;
  webPublishedAt: string | null;
  webUnpublishedAt: string | null;
  failureReason: string | null;
  deletedAt: string | null;
};

export type RecordingPhase =
  | "recording"
  | "preparing"
  | "ready_to_publish"
  | "published"
  | "needs_attention"
  | "unpublished"
  | "deleted";

export type RecordingPhaseView = {
  phase: RecordingPhase;
  /** Two or three words. Never a status code. */
  label: string;
  /** One sentence a volunteer can act on, or null when the label is enough. */
  detail: string | null;
};

/** Refusals that mean "try again later", not "this file is wrong". */
const TRANSIENT_REASONS = new Set([
  "probe_unavailable",
  "probe_timeout",
  "object_identity_unavailable",
  "object_changed",
]);

export function isPublishedAnywhere(row: RecordingRowState): boolean {
  const app =
    row.mobileVisibility !== "none" && Boolean(row.mobilePublishedAt) && !row.mobileUnpublishedAt;
  const web = Boolean(row.webPublishedAt) && !row.webUnpublishedAt;
  return app || web;
}

/**
 * Where a published recording can be watched, in the words a church uses.
 * "Published" on its own was ambiguous: a recording on the website only is
 * not in the app, and a pastor assumes "published" means the app.
 */
export function publishedWhereLabel(where: { app: boolean; website: boolean }): string {
  if (where.app && where.website) return "In the app and on the website";
  if (where.app) return "Published in the app";
  return "On the website only";
}

/**
 * The one mapping from a recording row to what a church is told. Labels come
 * from the canonical recording vocabulary (docs/ux audit §8.4): Live ·
 * Processing · Ready to publish · Published (saying where) · Not published ·
 * Problem. Tone, filters and next actions are derived from `phase` in
 * `lib/stream/recording-status.ts`, never from the label.
 */
export function recordingPhase(row: RecordingRowState): RecordingPhaseView {
  if (row.deletedAt || row.status === "deleted") {
    return { phase: "deleted", label: "Deleted", detail: null };
  }
  if (row.status === "recording") {
    return {
      phase: "recording",
      label: "Live",
      detail: "Recording automatically while the service is on air.",
    };
  }
  if (row.status === "processing") {
    return {
      phase: "preparing",
      label: "Processing",
      detail: "Your recording is being prepared. We'll show it here when it's ready to publish.",
    };
  }
  if (row.status === "failed") {
    return {
      phase: "needs_attention",
      label: "Problem",
      detail: failureExplanation(row.failureReason),
    };
  }
  // ready (or the legacy `published` value)
  if (!row.mobilePlayable) {
    if (!row.renditionVerifiedAt || TRANSIENT_REASONS.has(row.renditionReason ?? "")) {
      return {
        phase: "preparing",
        label: "Processing",
        detail: "FaithForm is checking this recording. This usually takes a minute.",
      };
    }
    return {
      phase: "needs_attention",
      label: "Problem",
      detail: playabilityExplanation(row.renditionReason),
    };
  }
  if (isPublishedAnywhere(row)) {
    const app =
      row.mobileVisibility !== "none" && Boolean(row.mobilePublishedAt) && !row.mobileUnpublishedAt;
    const website = Boolean(row.webPublishedAt) && !row.webUnpublishedAt;
    return { phase: "published", label: publishedWhereLabel({ app, website }), detail: null };
  }
  if (row.mobileUnpublishedAt || row.webUnpublishedAt) {
    return {
      phase: "unpublished",
      label: "Not published",
      detail: "Taken out of the app and website. The recording is still saved.",
    };
  }
  return { phase: "ready_to_publish", label: "Ready to publish", detail: null };
}

export function failureExplanation(reason: string | null): string {
  switch (reason) {
    case "nothing_recorded":
      return "No video reached FaithForm during this broadcast, so there was nothing to record.";
    case "segments_missing":
      return "Parts of this recording didn't finish saving. Your livestream information has been saved.";
    case "storage_unavailable":
      return "We couldn't prepare this recording. Your livestream information has been saved.";
    default:
      return "We couldn't prepare this recording. Your livestream information has been saved.";
  }
}

/** For a verified recording that phones cannot play. Names no codec. */
export function playabilityExplanation(reason: string | null): string {
  switch (reason) {
    case "video_codec_unsupported":
    case "audio_codec_unsupported":
    case "video_profile_unsupported":
    case "audio_profile_unsupported":
    case "audio_format_unsupported":
      return "Your streaming software is sending video in a format some phones can't play. In its settings, choose H.264 video (Setup, then Advanced, lists the recommended settings), and future services will record correctly.";
    case "segments_missing":
    case "file_missing":
      return "Parts of this recording didn't finish saving.";
    default:
      return "We couldn't prepare this recording for phones.";
  }
}

// ---------------------------------------------------------------------------
// The live recording indicator
// ---------------------------------------------------------------------------

export type RecordingIndicator =
  /** Confirmed: a segment was acknowledged recently. */
  | { state: "recording"; label: string; detail: string }
  /** Video just started; the first segment has not had time to land. */
  | { state: "starting"; label: string; detail: string }
  /** No video is arriving, so there is nothing to record. Not a recording fault. */
  | { state: "waiting_for_video"; label: string; detail: string }
  /** Video is arriving and FaithForm cannot confirm it is being saved. */
  | { state: "attention"; label: string; detail: string }
  | { state: "off"; label: string; detail: string };

/**
 * What the Live screen says about recording.
 *
 * **Derived only from backend evidence**: a segment FaithForm acknowledged, or
 * a relay heartbeat saying the recorder closed one moments ago. Never from the
 * fact that the dashboard pressed a button — which is the difference between a
 * recording indicator and a decoration.
 */
export function liveRecordingIndicator(input: {
  broadcastActive: boolean;
  videoArriving: boolean;
  /** When video started arriving for this broadcast, if known. */
  videoSince: string | null;
  lastSegmentAt: string | null;
  relay: {
    heartbeatAt: string | null;
    recorderRunning: boolean;
    lastSegmentClosedAt: string | null;
  } | null;
  now: number;
}): RecordingIndicator {
  if (!input.broadcastActive) {
    return { state: "off", label: "Not recording", detail: "Recording starts when you go live." };
  }

  const segmentFresh =
    input.lastSegmentAt !== null &&
    input.now - ms(input.lastSegmentAt) <= RECORDING_CONFIRMED_WINDOW_MS;

  const relayFresh =
    input.relay !== null &&
    input.relay.heartbeatAt !== null &&
    input.now - ms(input.relay.heartbeatAt) <= RELAY_HEARTBEAT_TTL_MS &&
    input.relay.recorderRunning &&
    input.relay.lastSegmentClosedAt !== null &&
    input.now - ms(input.relay.lastSegmentClosedAt) <= RECORDING_CONFIRMED_WINDOW_MS / 2;

  if (!input.videoArriving) {
    return {
      state: "waiting_for_video",
      label: "Waiting for video",
      detail: "Recording resumes automatically when your video comes back.",
    };
  }

  if (segmentFresh || relayFresh) {
    return {
      state: "recording",
      label: "Recording",
      detail: "Everything is being saved automatically.",
    };
  }

  const since = input.videoSince ? ms(input.videoSince) : null;
  if (since !== null && input.now - since < RECORDING_START_GRACE_MS) {
    return {
      state: "starting",
      label: "Starting recording…",
      detail: "FaithForm is starting to save your service.",
    };
  }

  return {
    state: "attention",
    label: "Recording needs attention",
    detail:
      "Your livestream is still running, but FaithForm could not confirm it is being recorded.",
  };
}

// ---------------------------------------------------------------------------
// Stream health, in plain language
// ---------------------------------------------------------------------------

export type IngestSnapshot = {
  publishing: boolean;
  heartbeatAt: string | null;
  bitrateKbps: number | null;
  width: number | null;
  height: number | null;
  fps: number | null;
  videoCodec: string | null;
  audioCodec: string | null;
  reconnects: number;
};

export type HealthNote = { tone: "good" | "warn" | "bad"; message: string };

export function describeStreamHealth(snapshot: IngestSnapshot | null, now: number): HealthNote[] {
  if (!snapshot || !snapshot.heartbeatAt || now - ms(snapshot.heartbeatAt) > RELAY_HEARTBEAT_TTL_MS * 2) {
    return [{ tone: "warn", message: "FaithForm isn't receiving video yet." }];
  }
  if (!snapshot.publishing) {
    return [
      {
        tone: "bad",
        message: "The video signal disconnected. FaithForm is waiting for your encoder to reconnect.",
      },
    ];
  }
  const notes: HealthNote[] = [{ tone: "good", message: "Receiving video." }];
  if (snapshot.bitrateKbps !== null && snapshot.bitrateKbps > 0 && snapshot.bitrateKbps < 800) {
    notes.push({
      tone: "warn",
      message: "Your internet upload looks slow. Viewers may see a blurry picture.",
    });
  }
  if (snapshot.videoCodec && !/^(h264|avc)/i.test(snapshot.videoCodec)) {
    notes.push({
      tone: "warn",
      message: "Your encoder is not sending H.264 video. Some phones may not play the recording.",
    });
  }
  if (!snapshot.audioCodec) {
    notes.push({ tone: "warn", message: "No sound is coming through from your encoder." });
  }
  if (snapshot.reconnects > 0) {
    notes.push({
      tone: "warn",
      message:
        snapshot.reconnects === 1
          ? "The video signal dropped once and reconnected. The recording continues."
          : `The video signal dropped ${snapshot.reconnects} times and reconnected. The recording continues.`,
    });
  }
  return notes;
}
