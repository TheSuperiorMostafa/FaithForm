import { createHash } from "node:crypto";

import type { SupabaseClient } from "@supabase/supabase-js";

import { createAdminClient } from "@/lib/supabase/admin";
import { STREAM_RECORDINGS_BUCKET } from "@/lib/stream/recording-storage";
import {
  assessRendition,
  isTransientRefusal,
  refuse,
  type RenditionReason,
  type RenditionVerdict,
} from "@/lib/media/v1/rendition";

/**
 * Proving a recording, against the object this server holds — and binding the
 * proof to *that* object rather than to the path it happened to be at.
 *
 * ## Why it reads bytes rather than metadata
 *
 * The three things that describe a recording are its filename, its stored
 * content-type, and whatever the relay said — and all three are claims. The
 * relay's uploader sends `content-type: video/mp4` unconditionally
 * (`infra/stream-relay/upload-recording.sh`), `sanitizeRecordingFilename`
 * accepts `.mkv`, and the relay is a client from this application's point of
 * view. The object is the only evidence.
 *
 * ## Why the proof is bound to an object identity
 *
 * A storage path is **mutable**. `upload-recording.sh` sends `x-upsert: true`,
 * so re-running it replaces the object under an unchanged path — and the same
 * is true of anyone with the service key. A verdict recorded against a path
 * therefore says nothing about what is at that path now.
 *
 * So every verdict carries an identity for the exact bytes it was taken from,
 * and that identity is re-checked before publication, before a capability is
 * issued, and on every delivery request. When it does not match, the recording
 * is not "probably still fine" — it is **unverified**, and it stops being
 * publishable and stops being playable until a fresh probe says otherwise.
 *
 * The identity has four parts, and is deliberately not dependent on any single
 * one of them:
 *
 *   * a **strong ETag**, when the provider returns one. A weak validator
 *     (`W/"…"`) is explicitly *not* accepted as identity — it promises semantic
 *     equivalence, which is not the question being asked.
 *   * a **version id**, when the provider exposes object versioning.
 *   * the **content length**.
 *   * a **SHA-256 over the exact bytes this parser inspected**. This is the part
 *     that never depends on the provider: it is computed from data already read,
 *     it costs nothing extra, and it is what makes the identity provable even if
 *     storage returns no validator at all.
 *
 * The hash covers the inspected window rather than the whole object, because
 * hashing a three-hour service would mean transferring it. That is a real limit
 * and is stated as one: a change confined to the middle of a file, outside both
 * the head and the tail window, is caught by the content length rather than by
 * the hash.
 *
 * ## Why the reads are bounded
 *
 * A service recording is gigabytes. Two range requests — 1 MiB from the front
 * and, only when needed, 4 MiB from the back — are enough to read `ftyp` and
 * locate `moov`, and are the difference between a check a dashboard can run and
 * a check that pulls a congregation's whole archive through a serverless
 * function. Every request also carries a timeout, because a probe that hangs is
 * a request that hangs.
 */

/** Enough for `ftyp` plus a faststart index on any realistic service. */
const HEAD_BYTES = 1024 * 1024;

/** Enough for a trailing index. Beyond this the file is not worth guessing at. */
const TAIL_BYTES = 4 * 1024 * 1024;

/**
 * How long one storage request may take before the probe gives up.
 *
 * Fails **closed**: a timeout is `probe_timeout`, which is not a verdict and
 * never makes anything publishable. Generous enough for a cold object in a
 * distant region, short enough that a hung provider does not hold a dashboard
 * request open.
 */
export const PROBE_TIMEOUT_MS = 15_000;

/** The cheap identity check runs on every grant, so it gets a tighter bound. */
export const IDENTITY_TIMEOUT_MS = 5_000;

/**
 * How long a verdict is trusted before it is taken again.
 *
 * Publishing always re-verifies regardless; this bounds how stale a *listing*
 * may be. A day is long enough that opening the media page is not a storage
 * scan, and short enough that a file deleted last week is not still advertised
 * as publishable.
 */
export const VERDICT_FRESHNESS_MS = 24 * 60 * 60 * 1000;

/**
 * The identity of the exact object a verdict was taken from.
 *
 * `null` in a field means "the provider did not tell us", which is different
 * from "it differs" — see `identityMatches`.
 */
export type ObjectIdentity = {
  /** A **strong** entity tag. A weak validator is discarded, not stored. */
  etag: string | null;
  versionId: string | null;
  sizeBytes: number | null;
  /** SHA-256, hex, over the bytes this probe actually inspected. */
  windowHash: string | null;
};

export const UNKNOWN_IDENTITY: ObjectIdentity = {
  etag: null,
  versionId: null,
  sizeBytes: null,
  windowHash: null,
};

export type RecordingRendition = {
  playable: boolean;
  kind: "hls" | "progressive" | null;
  reason: RenditionReason;
  container: string | null;
  videoCodec: string | null;
  audioCodec: string | null;
  videoProfile: string | null;
  audioProfile: string | null;
  audioSampleRate: number | null;
  audioChannels: number | null;
  verifiedAt: string | null;
  identity: ObjectIdentity;
  /**
   * Which verdict this is.
   *
   * The optimistic-concurrency token a publish is checked against. An integer
   * rather than the verification timestamp, because a timestamp loses
   * microseconds crossing the driver and never matches on the way back.
   */
  revision: number;
};

function client(supabase?: SupabaseClient) {
  return supabase ?? createAdminClient();
}

// ---------------------------------------------------------------------------
// Object identity
// ---------------------------------------------------------------------------

/**
 * Reads an entity tag, keeping only strong ones.
 *
 * `W/"abc"` is a *weak* validator: it promises the two representations are
 * semantically equivalent, not that they are byte-identical. Two different
 * encodings of the same sermon can legitimately share one. Treating it as
 * identity would mean accepting exactly the substitution this whole mechanism
 * exists to detect, so it is dropped.
 */
export function strongEtag(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.startsWith("W/") || trimmed.startsWith("w/")) return null;
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * The identity a live response is advertising, read from its headers.
 *
 * Exported because the delivery route needs exactly this and must not grow its
 * own slightly-different version: two subtly different readings of the same
 * headers is how one of them ends up trusting a weak validator.
 */
export function responseIdentity(headers: Headers): ObjectIdentity {
  return identityFromHeaders(headers, null);
}

/** Version identifiers, in the order providers tend to expose them. */
const VERSION_HEADERS = ["x-amz-version-id", "x-version-id", "x-object-version"];

function identityFromHeaders(headers: Headers, fallbackSize: number | null): ObjectIdentity {
  const contentRange = headers.get("content-range");
  const total = contentRange
    ? Number(contentRange.split("/")[1]) || null
    : Number(headers.get("content-length")) || null;

  let versionId: string | null = null;
  for (const header of VERSION_HEADERS) {
    const value = headers.get(header);
    if (value) {
      versionId = value;
      break;
    }
  }

  return {
    etag: strongEtag(headers.get("etag")),
    versionId,
    sizeBytes: total ?? fallbackSize,
    windowHash: null,
  };
}

/**
 * Whether the object in front of us is the one that was verified.
 *
 * Any discriminator that both sides know and that **disagrees** is a mismatch.
 * A discriminator only one side knows proves nothing either way and is skipped —
 * a provider that stopped returning ETags must not silently invalidate a
 * congregation's whole archive.
 *
 * The floor is that *something* must agree: an identity with no comparable field
 * at all is not a match, because it is not evidence. That is what makes this
 * fail closed rather than degrade to "the path is the same".
 */
export function identityMatches(verified: ObjectIdentity, current: ObjectIdentity): boolean {
  let compared = 0;

  for (const field of ["etag", "versionId", "sizeBytes", "windowHash"] as const) {
    const before = verified[field];
    const now = current[field];
    if (before === null || before === undefined) continue;
    if (now === null || now === undefined) continue;
    compared += 1;
    if (before !== now) return false;
  }

  return compared > 0;
}

/** A request that cannot outlive its budget. */
async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<Response | { error: RenditionReason }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    // An abort and a transport failure are both "no answer", but only one of
    // them is worth saying out loud in a log the operator reads.
    const aborted = error instanceof Error && error.name === "AbortError";
    return { error: aborted ? "probe_timeout" : "probe_unavailable" };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetches a byte range of the stored object.
 *
 * The signed URL lives for sixty seconds, is used here, and is never returned —
 * the same discipline the recording delivery route follows, for the same
 * reason: a longer-lived storage URL is a bearer token for a video file.
 */
async function readRange(
  storagePath: string,
  range: string,
  supabase: SupabaseClient,
  timeoutMs = PROBE_TIMEOUT_MS,
): Promise<{ bytes: Uint8Array; identity: ObjectIdentity } | { error: RenditionReason }> {
  const { data: signed, error } = await supabase.storage
    .from(STREAM_RECORDINGS_BUCKET)
    .createSignedUrl(storagePath, 60);

  if (error || !signed?.signedUrl) {
    // Supabase reports a missing object and an unreachable bucket the same way,
    // so this distinguishes them by message rather than guessing.
    const missing = /not found|does not exist|no such/i.test(error?.message ?? "");
    return { error: missing ? "file_missing" : "probe_unavailable" };
  }

  const response = await fetchWithTimeout(
    signed.signedUrl,
    { cache: "no-store", headers: { Range: range } },
    timeoutMs,
  );
  if ("error" in response) return response;

  if (response.status === 404) return { error: "file_missing" };
  if (response.status === 416) return { error: "file_corrupt" };
  if (!response.ok && response.status !== 206) return { error: "probe_unavailable" };

  try {
    const bytes = new Uint8Array(await response.arrayBuffer());
    return { bytes, identity: identityFromHeaders(response.headers, bytes.length) };
  } catch {
    return { error: "probe_unavailable" };
  }
}

/**
 * Reads the object's identity without transferring it.
 *
 * A one-byte ranged GET: the response carries the validator and, through
 * `Content-Range`, the full length. Cheap enough to run on every capability
 * issuance and every delivery request, which is where it does its work.
 */
export async function readObjectIdentity(
  storagePath: string,
  supabase?: SupabaseClient,
): Promise<ObjectIdentity | { error: RenditionReason }> {
  const db = client(supabase);
  const { data: signed, error } = await db.storage
    .from(STREAM_RECORDINGS_BUCKET)
    .createSignedUrl(storagePath, 60);

  if (error || !signed?.signedUrl) {
    const missing = /not found|does not exist|no such/i.test(error?.message ?? "");
    return { error: missing ? "file_missing" : "probe_unavailable" };
  }

  const response = await fetchWithTimeout(
    signed.signedUrl,
    { cache: "no-store", headers: { Range: "bytes=0-0" } },
    IDENTITY_TIMEOUT_MS,
  );
  if ("error" in response) return response;

  if (response.status === 404) return { error: "file_missing" };
  if (!response.ok && response.status !== 206) return { error: "probe_unavailable" };

  // The body is one byte and is not needed; draining it keeps the connection
  // reusable rather than leaving it to be torn down.
  try {
    await response.arrayBuffer();
  } catch {
    /* the identity is in the headers, which are already read */
  }

  return identityFromHeaders(response.headers, null);
}

function hashWindow(head: Uint8Array, tail: Uint8Array | null): string {
  const digest = createHash("sha256");
  digest.update(head);
  if (tail) digest.update(tail);
  return digest.digest("hex");
}

// ---------------------------------------------------------------------------
// Probing
// ---------------------------------------------------------------------------

/**
 * Probes one recording and returns what its bytes prove, with the identity of
 * the bytes that proved it.
 *
 * Does not write anything. `verifyRecording` persists.
 */
export async function probeRecording(
  storagePath: string,
  supabase?: SupabaseClient,
): Promise<{ verdict: RenditionVerdict; identity: ObjectIdentity }> {
  const db = client(supabase);

  const head = await readRange(storagePath, `bytes=0-${HEAD_BYTES - 1}`, db);
  if ("error" in head) {
    return { verdict: refuse(head.error), identity: UNKNOWN_IDENTITY };
  }

  const firstPass = assessRendition(head.bytes);
  // Only the missing index is worth a second request; a Matroska file or an
  // unsupported profile is already decided and reading more would prove nothing.
  if (firstPass.reason !== "index_not_found") {
    return {
      verdict: firstPass,
      identity: { ...head.identity, windowHash: hashWindow(head.bytes, null) },
    };
  }

  const total = head.identity.sizeBytes;
  if (!total || total <= head.bytes.length) {
    // The whole file was already read and there was no index in it.
    return {
      verdict: firstPass,
      identity: { ...head.identity, windowHash: hashWindow(head.bytes, null) },
    };
  }

  const from = Math.max(0, total - TAIL_BYTES);
  const tail = await readRange(storagePath, `bytes=${from}-${total - 1}`, db);
  if ("error" in tail) {
    return { verdict: refuse(tail.error, { container: firstPass.container }), identity: UNKNOWN_IDENTITY };
  }

  // **Both halves must come from the same object.** Between the two requests the
  // path can be overwritten, and stitching a new file's tail onto an old file's
  // head would prove a rendition that never existed.
  if (!identityMatches(head.identity, tail.identity)) {
    return { verdict: refuse("object_changed", { container: firstPass.container }), identity: UNKNOWN_IDENTITY };
  }

  return {
    verdict: assessRendition(head.bytes, tail.bytes),
    identity: { ...tail.identity, windowHash: hashWindow(head.bytes, tail.bytes) },
  };
}

/**
 * Probes a recording and records the verdict together with the identity it was
 * taken from.
 *
 * The tenant predicate is on the write, so a recording id from another church
 * records nothing rather than being marked playable by a guess.
 */
export async function verifyRecording(
  input: { recordingId: string; churchId: string; storagePath: string },
  supabase?: SupabaseClient,
): Promise<RecordingRendition> {
  const db = client(supabase);
  const { verdict, identity } = await probeRecording(input.storagePath, db);

  // An identity that cannot be established is not a verdict. Refusing here means
  // a recording is never marked playable without something to bind that claim
  // to — the whole point of binding it.
  //
  // Two halves, and both are load-bearing. The **hash** is what publication
  // compares, and is always computable from bytes already read. At least one of
  // **ETag, version id or length** is what a capability issuance and a delivery
  // request compare, because neither can re-hash a window without transferring
  // it. A verdict with only the hash would be unpublishable-adjacent: publishable
  // and then undeliverable, which is worse than refusing it here.
  const provable =
    identity.windowHash !== null &&
    (identity.etag !== null || identity.versionId !== null || identity.sizeBytes !== null);
  const playable = verdict.playable && provable;
  const reason = verdict.playable && !provable ? "object_identity_unavailable" : verdict.reason;

  const { data } = await db.rpc("record_recording_rendition", {
    p_recording_id: input.recordingId,
    p_church_id: input.churchId,
    p_playable: playable,
    p_kind: playable ? verdict.kind : null,
    p_reason: reason,
    p_container: verdict.container,
    p_video_codec: verdict.videoCodec,
    p_audio_codec: verdict.audioCodec,
    p_video_profile: verdict.videoProfile,
    p_audio_profile: verdict.audioProfile,
    p_audio_sample_rate: verdict.audioSampleRate,
    p_audio_channels: verdict.audioChannels,
    p_object_size: identity.sizeBytes,
    p_object_etag: identity.etag,
    p_object_version: identity.versionId,
    p_object_hash: identity.windowHash,
  });

  const row = ((data ?? []) as Record<string, unknown>[])[0];

  return {
    playable: Boolean(row?.playable) && playable,
    kind: playable ? verdict.kind : null,
    reason,
    container: verdict.container,
    videoCodec: verdict.videoCodec,
    audioCodec: verdict.audioCodec,
    videoProfile: verdict.videoProfile,
    audioProfile: verdict.audioProfile,
    audioSampleRate: verdict.audioSampleRate,
    audioChannels: verdict.audioChannels,
    verifiedAt: row?.ok ? new Date().toISOString() : null,
    identity,
    revision: Number(row?.revision ?? 0),
  };
}

/**
 * Whether a stored verdict may be trusted without probing again.
 *
 * A transient failure is never trusted: "storage was unreachable a minute ago"
 * is not a verdict, and treating it as one would leave a perfectly good
 * recording unpublishable until somebody noticed.
 */
export function verdictIsFresh(input: {
  verifiedAt: string | null;
  reason: string | null;
  now?: Date;
}): boolean {
  if (!input.verifiedAt) return false;
  if (input.reason && isTransientRefusal(input.reason as RenditionReason)) return false;
  const age = (input.now ?? new Date()).getTime() - new Date(input.verifiedAt).getTime();
  return age >= 0 && age <= VERDICT_FRESHNESS_MS;
}

/**
 * Confirms the object in storage is still the one that was verified.
 *
 * Used at capability issuance and before delivery. The persisted verdict says
 * *these bytes* were playable; this says the bytes at that path are still those
 * bytes.
 *
 * The earlier version of this function only asked whether *something* existed at
 * the path. That was strictly weaker than it looked: `upload-recording.sh` sends
 * `x-upsert: true`, so a replacement lands at the same path and passes an
 * existence check while being an entirely different file.
 *
 * Deliberately cheap — one signed-URL mint and a one-byte ranged GET — because
 * it runs on every grant and every refresh.
 */
export async function renditionIdentityUnchanged(
  storagePath: string,
  verified: ObjectIdentity,
  supabase?: SupabaseClient,
): Promise<{ ok: true; identity: ObjectIdentity } | { ok: false; reason: RenditionReason }> {
  const current = await readObjectIdentity(storagePath, supabase);
  if ("error" in current) return { ok: false, reason: current.error };
  if (!identityMatches(verified, current)) return { ok: false, reason: "object_changed" };
  return { ok: true, identity: current };
}
