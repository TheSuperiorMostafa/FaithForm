import { isFacebookAuthError } from "@/lib/integrations/facebook-token";

/**
 * Facebook Page Reels publishing client (Graph API resumable upload).
 *
 * Reels use their own Graph version so the rest of the Facebook integration
 * (still on v21.0 via `GRAPH`) is not moved along with it.
 *
 * Every failure is a `ReelProviderError` whose `kind` tells the caller what is
 * safe to do next:
 *  - `retryable`: Meta definitely did not act (or the step is safe to repeat);
 *    try again later.
 *  - `terminal`: Meta refused for a reason retrying will not fix.
 *  - `ambiguous`: the request may have been received and acted on (network
 *    failure, timeout or 5xx on a non-repeatable step such as finish). Check
 *    the video status before doing anything else.
 *  - `auth`: the Page token was rejected; refresh it once, then reconnect.
 *
 * Messages are fixed, plain staff-facing text. Tokens and token-bearing URLs
 * never appear in messages, and nothing here logs.
 */

export const FACEBOOK_REELS_GRAPH_VERSION = "v27.0";

/** The Reels Graph version, overridable with env FACEBOOK_REELS_GRAPH_VERSION. */
export function resolveReelsGraphVersion(
  env: Record<string, string | undefined> = process.env,
): string {
  const override = env.FACEBOOK_REELS_GRAPH_VERSION?.trim();
  return override && /^v\d{1,3}\.\d{1,2}$/.test(override)
    ? override
    : FACEBOOK_REELS_GRAPH_VERSION;
}

export type ReelErrorKind = "retryable" | "terminal" | "ambiguous" | "auth";

export class ReelProviderError extends Error {
  readonly kind: ReelErrorKind;
  readonly code: string;
  readonly httpStatus: number | null;
  readonly providerCode: number | null;
  /** Suggested wait before retrying, for `retryable` errors. */
  readonly retryAfterSec: number | null;

  constructor(input: {
    kind: ReelErrorKind;
    code: string;
    message: string;
    httpStatus?: number | null;
    providerCode?: number | null;
    retryAfterSec?: number | null;
  }) {
    super(input.message);
    this.name = "ReelProviderError";
    this.kind = input.kind;
    this.code = input.code;
    this.httpStatus = input.httpStatus ?? null;
    this.providerCode = input.providerCode ?? null;
    this.retryAfterSec = input.retryAfterSec ?? null;
  }
}

export function isReelProviderError(error: unknown): error is ReelProviderError {
  return error instanceof ReelProviderError;
}

export type ReelPhaseStatus =
  | "not_started"
  | "in_progress"
  | "completed"
  | "complete"
  | "error"
  | (string & {});

export type ReelVideoStatus = {
  video_status?: string;
  uploading_phase?: {
    status?: ReelPhaseStatus;
    bytes_transfered?: number | string;
    errors?: unknown[];
  };
  processing_phase?: { status?: ReelPhaseStatus; error?: unknown };
  publishing_phase?: {
    status?: ReelPhaseStatus;
    publish_status?: string;
    publish_time?: number | string;
    errors?: unknown[];
  };
};

export type ReelInterpretation =
  | "uploading"
  | "uploaded"
  | "processing"
  | "published"
  | "failed"
  | "unknown";

export type ReelProviderOptions = {
  fetch: typeof fetch;
  /** Defaults to `resolveReelsGraphVersion()`. */
  graphVersion?: string;
  pageId: string;
  pageToken: string;
  /** Per-request timeout for Graph calls. Default 30 s. */
  timeoutMs?: number;
  /** Timeout for the binary upload. Default 15 min. */
  uploadTimeoutMs?: number;
};

export type ReelUploadInput = {
  /** The upload_url from start; falls back to the rupload URL for the video. */
  uploadUrl?: string | null;
  videoId: string;
  body: ReadableStream<Uint8Array> | Uint8Array;
  fileSize: number;
  offset: number;
};

export interface ReelProvider {
  readonly pageId: string;
  verifyPage(): Promise<{ id: string; name: string | null }>;
  startUpload(): Promise<{ videoId: string; uploadUrl: string }>;
  uploadBinary(input: ReelUploadInput): Promise<void>;
  finish(input: {
    videoId: string;
    description: string;
  }): Promise<{ postId: string | null }>;
  getStatus(videoId: string): Promise<ReelVideoStatus>;
  getPermalink(input: {
    videoId: string;
    postId?: string | null;
  }): Promise<string | null>;
}

type GraphError = {
  message?: string;
  type?: string;
  code?: number;
  error_subcode?: number;
  is_transient?: boolean;
};

type Step = "verify" | "start" | "upload" | "finish" | "status" | "permalink";

const MESSAGES = {
  network: "Could not reach Facebook. FaithForm will try again.",
  timeout: "Facebook took too long to answer. FaithForm will try again.",
  unavailable: "Facebook is having trouble right now. FaithForm will try again.",
  finishUnknown:
    "Facebook may have received the Reel, but did not confirm it. FaithForm is checking before trying again.",
  rateLimited:
    "This Facebook Page has reached its limit for Reels posted by apps today. FaithForm will try again later.",
  throttled: "Facebook asked FaithForm to slow down. FaithForm will try again shortly.",
  blocked:
    "Facebook blocked this Reel. Check the Page's notifications on Facebook for details.",
  auth: "Facebook access expired. Reconnect Facebook in Settings.",
  permission:
    "FaithForm does not have permission to post Reels to this Page. Reconnect Facebook and allow Page posting.",
  pageChanged:
    "The connected Facebook Page has changed. Check the Page in Settings before posting.",
  pageUnavailable:
    "The connected Facebook Page could not be found. Reconnect Facebook in Settings.",
  uploadFailed: "Facebook could not accept the video file. Try making the clip again.",
  uploadInterrupted: "The video upload was interrupted. FaithForm will resume it.",
  invalid: "Facebook did not accept this Reel. Check the caption and video, then try again.",
  rejected: "Facebook did not accept this Reel.",
  badResponse: "Facebook sent an unexpected answer. FaithForm will try again.",
} as const;

const RATE_LIMIT_CODES = new Set([4, 17, 32, 80001]);

function graphErrorToReelError(
  step: Step,
  httpStatus: number,
  error: GraphError | undefined,
): ReelProviderError {
  const code = error?.code;
  const base = { httpStatus, providerCode: code ?? null };

  if (error && isFacebookAuthError(error)) {
    return new ReelProviderError({ ...base, kind: "auth", code: "reconnect_required", message: MESSAGES.auth });
  }
  if (code === 613) {
    return new ReelProviderError({ ...base, kind: "retryable", code: "rate_limited", message: MESSAGES.rateLimited, retryAfterSec: 3600 });
  }
  if (code !== undefined && RATE_LIMIT_CODES.has(code)) {
    return new ReelProviderError({ ...base, kind: "retryable", code: "throttled", message: MESSAGES.throttled, retryAfterSec: 300 });
  }
  if (code === 368) {
    return new ReelProviderError({ ...base, kind: "terminal", code: "blocked", message: MESSAGES.blocked });
  }
  if (code === 6000) {
    // Upload errors are resumable: the next attempt re-reads the offset.
    return step === "upload"
      ? new ReelProviderError({ ...base, kind: "retryable", code: "upload_interrupted", message: MESSAGES.uploadInterrupted })
      : new ReelProviderError({ ...base, kind: "terminal", code: "upload_failed", message: MESSAGES.uploadFailed });
  }
  if (code === 10 || code === 200 || (code !== undefined && code > 200 && code < 300)) {
    return new ReelProviderError({ ...base, kind: "terminal", code: "permission_missing", message: MESSAGES.permission });
  }
  if (httpStatus >= 500 || code === 1 || code === 2 || error?.is_transient) {
    return step === "finish"
      ? new ReelProviderError({ ...base, kind: "ambiguous", code: "finish_unconfirmed", message: MESSAGES.finishUnknown })
      : new ReelProviderError({ ...base, kind: "retryable", code: "facebook_unavailable", message: MESSAGES.unavailable, retryAfterSec: 60 });
  }
  if (step === "verify" && (code === 100 || httpStatus === 404)) {
    return new ReelProviderError({ ...base, kind: "terminal", code: "page_unavailable", message: MESSAGES.pageUnavailable });
  }
  if (code === 100) {
    return new ReelProviderError({ ...base, kind: "terminal", code: "invalid_request", message: MESSAGES.invalid });
  }
  return new ReelProviderError({ ...base, kind: "terminal", code: "facebook_rejected", message: MESSAGES.rejected });
}

function transportError(step: Step, timedOut: boolean): ReelProviderError {
  if (step === "finish") {
    return new ReelProviderError({ kind: "ambiguous", code: "finish_unconfirmed", message: MESSAGES.finishUnknown });
  }
  return new ReelProviderError({
    kind: "retryable",
    code: timedOut ? "timeout" : "network_error",
    message: timedOut ? MESSAGES.timeout : MESSAGES.network,
    retryAfterSec: 30,
  });
}

function badResponse(step: Step, httpStatus: number): ReelProviderError {
  if (step === "finish") {
    return new ReelProviderError({ kind: "ambiguous", code: "finish_unconfirmed", message: MESSAGES.finishUnknown, httpStatus });
  }
  return new ReelProviderError({ kind: "retryable", code: "bad_response", message: MESSAGES.badResponse, httpStatus, retryAfterSec: 60 });
}

const ID_PATTERN = /^[0-9]{1,40}$/;

/** Only Meta's own upload host may receive the token in an Authorization header. */
function safeUploadUrl(candidate: string | null | undefined): string | null {
  if (!candidate) return null;
  try {
    const url = new URL(candidate);
    if (url.protocol !== "https:") return null;
    if (url.hostname !== "rupload.facebook.com" && !url.hostname.endsWith(".facebook.com")) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

/** Accepts only https://www.facebook.com/... links (relative paths are resolved there). */
export function normalizeReelPermalink(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const raw = value.trim();
  try {
    const url = raw.startsWith("/") && !raw.startsWith("//")
      ? new URL(raw, "https://www.facebook.com")
      : new URL(raw);
    if (url.protocol !== "https:" || url.hostname !== "www.facebook.com") return null;
    if (url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function createFacebookReelsClient(options: ReelProviderOptions): ReelProvider {
  const fetchImpl = options.fetch;
  const version = options.graphVersion ?? resolveReelsGraphVersion();
  const pageId = options.pageId;
  const token = options.pageToken;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const uploadTimeoutMs = options.uploadTimeoutMs ?? 15 * 60_000;
  const graph = `https://graph.facebook.com/${version}`;

  if (!ID_PATTERN.test(pageId)) {
    throw new ReelProviderError({ kind: "terminal", code: "page_unavailable", message: MESSAGES.pageUnavailable });
  }

  async function send(
    step: Step,
    url: string,
    init: RequestInit & { duplex?: "half" },
    limitMs = timeoutMs,
  ): Promise<{ status: number; ok: boolean; data: Record<string, unknown> }> {
    const controller = new AbortController();
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, limitMs);
    try {
      let res: Response;
      try {
        res = await fetchImpl(url, { ...init, signal: controller.signal });
      } catch {
        throw transportError(step, timedOut);
      }
      let data: Record<string, unknown>;
      try {
        const parsed: unknown = await res.json();
        data = parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
      } catch {
        if (timedOut) throw transportError(step, true);
        data = {};
      }
      if (!res.ok || data.error) {
        throw graphErrorToReelError(step, res.status, data.error as GraphError | undefined);
      }
      return { status: res.status, ok: res.ok, data };
    } finally {
      clearTimeout(timer);
    }
  }

  const authHeader = { Authorization: `OAuth ${token}` };

  function form(fields: Record<string, string>): URLSearchParams {
    return new URLSearchParams({ ...fields, access_token: token });
  }

  async function getFields(step: Step, objectId: string, fields: string) {
    return send(step, `${graph}/${objectId}?${new URLSearchParams({ fields })}`, {
      method: "GET",
      headers: authHeader,
    });
  }

  return {
    pageId,

    async verifyPage() {
      const { status, data } = await getFields("verify", pageId, "id,name");
      const id = typeof data.id === "string" ? data.id : null;
      if (!id) throw badResponse("verify", status);
      if (id !== pageId) {
        throw new ReelProviderError({ kind: "terminal", code: "page_changed", message: MESSAGES.pageChanged, httpStatus: status });
      }
      return { id, name: typeof data.name === "string" ? data.name : null };
    },

    async startUpload() {
      const { status, data } = await send("start", `${graph}/${pageId}/video_reels`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({ upload_phase: "start" }),
      });
      const videoId = typeof data.video_id === "string" ? data.video_id : null;
      if (!videoId || !ID_PATTERN.test(videoId)) throw badResponse("start", status);
      const uploadUrl =
        safeUploadUrl(typeof data.upload_url === "string" ? data.upload_url : null) ??
        `https://rupload.facebook.com/video-upload/${version}/${videoId}`;
      return { videoId, uploadUrl };
    },

    async uploadBinary(input) {
      if (!ID_PATTERN.test(input.videoId)) throw badResponse("upload", 0);
      const url =
        safeUploadUrl(input.uploadUrl) ??
        `https://rupload.facebook.com/video-upload/${version}/${input.videoId}`;
      const init: RequestInit & { duplex?: "half" } = {
        method: "POST",
        headers: {
          ...authHeader,
          offset: String(input.offset),
          file_size: String(input.fileSize),
          "Content-Type": "application/octet-stream",
        },
        body: input.body as BodyInit,
      };
      // Node's fetch requires half-duplex for streamed request bodies.
      if (!(input.body instanceof Uint8Array)) init.duplex = "half";
      const { status, data } = await send("upload", url, init, uploadTimeoutMs);
      if (data.success !== true) {
        throw new ReelProviderError({ kind: "retryable", code: "upload_interrupted", message: MESSAGES.uploadInterrupted, httpStatus: status, retryAfterSec: 30 });
      }
    },

    async finish({ videoId, description }) {
      const { status, data } = await send("finish", `${graph}/${pageId}/video_reels`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form({
          video_id: videoId,
          upload_phase: "finish",
          video_state: "PUBLISHED",
          description,
        }),
      });
      if (data.success !== true) throw badResponse("finish", status);
      const postId = typeof data.post_id === "string" && data.post_id.length <= 80 ? data.post_id : null;
      return { postId };
    },

    async getStatus(videoId) {
      const { status, data } = await getFields("status", videoId, "status");
      const value = data.status;
      if (!value || typeof value !== "object") throw badResponse("status", status);
      return value as ReelVideoStatus;
    },

    async getPermalink({ videoId, postId }) {
      // Not documented for Reels: try the video, then the post, else nothing.
      const candidates = [videoId, postId].filter((id): id is string => Boolean(id));
      for (const id of candidates) {
        try {
          const { data } = await getFields("permalink", id, "permalink_url");
          const link = normalizeReelPermalink(data.permalink_url);
          if (link) return link;
        } catch (error) {
          if (isReelProviderError(error) && error.kind === "auth") throw error;
        }
      }
      return null;
    },
  };
}

function phaseDone(status: string | undefined): boolean {
  return status === "complete" || status === "completed";
}

/** Bytes Meta reports as received, or null when it does not say. */
export function uploadedBytes(status: ReelVideoStatus): number | null {
  const raw = status.uploading_phase?.bytes_transfered;
  const n = typeof raw === "string" ? Number(raw) : raw;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

export function interpretStatus(status: ReelVideoStatus | null | undefined): ReelInterpretation {
  if (!status) return "unknown";
  const video = status.video_status;
  const upload = status.uploading_phase?.status;
  const processing = status.processing_phase?.status;
  const publishing = status.publishing_phase?.status;
  const publishStatus = status.publishing_phase?.publish_status;

  if (
    video === "error" ||
    video === "expired" ||
    video === "upload_failed" ||
    upload === "error" ||
    processing === "error" ||
    publishing === "error" ||
    publishStatus === "error"
  ) {
    return "failed";
  }

  if (
    (publishStatus === "published" && (phaseDone(publishing) || video === "ready")) ||
    (publishStatus === undefined && phaseDone(publishing) && video === "ready")
  ) {
    return "published";
  }

  const uploadDone =
    phaseDone(upload) ||
    video === "upload_complete" ||
    video === "processing" ||
    video === "ready";
  if (!uploadDone && (video === "uploading" || upload === "in_progress" || upload === "not_started")) {
    return "uploading";
  }
  if (uploadDone && (publishing === undefined || publishing === "not_started")) {
    return "uploaded";
  }
  if (uploadDone || processing === "in_progress" || publishing === "in_progress") {
    return "processing";
  }
  return "unknown";
}

export type ReelMediaProbe = {
  container?: string | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  duration_sec?: number | null;
  video_codec?: string | null;
  pix_fmt?: string | null;
  audio_codec?: string | null;
  audio_rate?: number | null;
  audio_channels?: number | null;
  faststart?: boolean | null;
  gop_sec?: number | null;
};

const REEL_VIDEO_CODECS = new Set(["h264", "hevc", "h265", "vp9", "av1"]);

/** Checks an ffprobe summary against Facebook's Reels spec, in plain language. */
export function validateReelMedia(probe: ReelMediaProbe): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const container = probe.container?.toLowerCase() ?? "";
  if (!container.split(",").map((part) => part.trim()).some((part) => part === "mp4")) {
    problems.push("The video must be an MP4 file.");
  }

  const { width, height } = probe;
  if (!width || !height || width <= 0 || height <= 0) {
    problems.push("The video size could not be read.");
  } else {
    const ratio = width / height;
    if (Math.abs(ratio - 9 / 16) / (9 / 16) > 0.01) {
      problems.push("The video must be vertical (9:16).");
    }
    if (width < 540 || height < 960) {
      problems.push("The video must be at least 540 × 960 pixels.");
    }
  }

  if (!probe.fps || probe.fps < 24 || probe.fps > 60) {
    problems.push("The frame rate must be between 24 and 60 frames per second.");
  }
  if (!probe.duration_sec || probe.duration_sec < 3 || probe.duration_sec > 90) {
    problems.push("Reels must be between 3 and 90 seconds long.");
  }
  if (!REEL_VIDEO_CODECS.has(probe.video_codec?.toLowerCase() ?? "")) {
    problems.push("The video must use H.264, HEVC, VP9 or AV1.");
  }
  if (probe.pix_fmt?.toLowerCase() !== "yuv420p") {
    problems.push("The video colour format must be standard (yuv420p).");
  }
  if (probe.audio_codec?.toLowerCase() !== "aac") {
    problems.push("The sound must be AAC audio.");
  }
  if (probe.audio_rate !== 48000) {
    problems.push("The sound must be recorded at 48 kHz.");
  }
  if (probe.audio_channels != null && (probe.audio_channels < 1 || probe.audio_channels > 2)) {
    problems.push("The sound must be mono or stereo.");
  }
  if (probe.faststart === false) {
    problems.push("The video is not prepared for streaming (fast start).");
  }
  if (probe.gop_sec != null && (probe.gop_sec < 2 || probe.gop_sec > 5)) {
    problems.push("The video keyframes must be 2 to 5 seconds apart.");
  }

  return { ok: problems.length === 0, problems };
}
