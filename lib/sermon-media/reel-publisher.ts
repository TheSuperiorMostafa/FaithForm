import {
  interpretStatus,
  isReelProviderError,
  ReelProviderError,
  uploadedBytes,
  type ReelProvider,
  type ReelVideoStatus,
} from "@/lib/integrations/facebook-reels";

/**
 * State machine that publishes one approved clip render as a Facebook Page Reel.
 *
 *   starting → uploading → finishing → processing → posted
 *                  ↑            │            │
 *                  └── needs_check ←─────────┘ (finish unconfirmed)
 *   any step → failed (terminal error, reconnect required)
 *
 * Safety rules:
 *  - The Meta video id is persisted the moment `start` returns, before any
 *    bytes are sent, so a retried step resumes that video and never starts a
 *    second one.
 *  - `finish` publishes. It is sent once per video id. Entering `finishing`
 *    is persisted (with `finish_attempts` and `finish_requested_at`) before
 *    the request goes out, so a crash mid-finish is seen as "unconfirmed" and
 *    resolved by reading the video status rather than by finishing again.
 *  - An unconfirmed finish is re-sent at most once, and only when Meta shows
 *    the upload complete but publishing never started after a grace period.
 *  - `posted` is recorded only when Meta reports the Reel as published.
 *
 * Every step runs under a short row lock and a compare-and-set on status, so
 * concurrent calls (double clicks, cron overlapping a request) cannot both act.
 */

export type ReelPostStatus =
  | "starting"
  | "uploading"
  | "finishing"
  | "processing"
  | "posted"
  | "failed"
  | "needs_check";

/**
 * Row shape of `public.facebook_reel_posts` used here. `finish_attempts` and
 * `finish_requested_at` are needed by the finish-once rule.
 */
export type ReelPostRow = {
  id: string;
  church_id: string;
  render_id: string;
  page_id: string;
  caption: string;
  status: ReelPostStatus;
  provider_video_id: string | null;
  provider_post_id: string | null;
  permalink: string | null;
  last_error_code: string | null;
  last_error: string | null;
  check_attempts: number;
  finish_attempts: number;
  finish_requested_at: string | null;
  posted_at: string | null;
  last_checked_at: string | null;
};

export type ReelPostPatch = Partial<
  Pick<
    ReelPostRow,
    | "status"
    | "provider_video_id"
    | "provider_post_id"
    | "permalink"
    | "last_error_code"
    | "last_error"
    | "check_attempts"
    | "finish_attempts"
    | "finish_requested_at"
    | "posted_at"
    | "last_checked_at"
  >
>;

export type ReelPostInsert = {
  church_id: string;
  clip_id: string;
  render_id: string;
  page_id: string;
  page_name?: string | null;
  caption: string;
  approved_by: string;
  approved_at: string;
  posted_by: string;
};

export interface ReelPostRepo {
  load(postId: string): Promise<ReelPostRow | null>;
  /**
   * Applies `patch` only while the row is still in `expectedStatus`
   * (compare-and-set). Returns the updated row, or null when it no longer
   * matched.
   */
  update(
    postId: string,
    patch: ReelPostPatch,
    expectedStatus: ReelPostStatus,
  ): Promise<ReelPostRow | null>;
  /** Sets `step_lock_until` when free or expired. True when this caller holds it. */
  acquireStepLock(postId: string, seconds: number): Promise<boolean>;
  releaseStepLock(postId: string): Promise<void>;
  /** Inserts, or returns the existing open row for (render_id, page_id). */
  insertOnce(input: ReelPostInsert): Promise<{ row: ReelPostRow; created: boolean }>;
}

export type ReelRender = {
  stream: ReadableStream<Uint8Array> | Uint8Array;
  /** Total size of the file in bytes. */
  size: number;
};

export interface ReelPublisherDeps {
  repo: ReelPostRepo;
  /** Client already constructed for the post's Page and its Page token. */
  provider: ReelProvider;
  /** Re-derives the Page token once after an auth error; null when it cannot. */
  refreshProvider?: () => Promise<ReelProvider | null>;
  /** Flags the Facebook connection as needing reconnect (e.g. markIntegrationNeedsReconnect). */
  markReconnectRequired: (reason: string) => Promise<void>;
  /** Opens the rendered MP4 from the start. The publisher skips to the resume offset. */
  openRender: () => Promise<ReelRender>;
  now: () => Date;
  options?: {
    /** Wait before one re-finish of an unconfirmed finish. Default 600 s. */
    refinishGraceSec?: number;
    /** Step lock length; must cover a full upload. Default 1200 s. */
    lockSeconds?: number;
  };
}

export type AdvanceReelOutcome =
  | "posted"
  | "failed"
  | "waiting"
  | "retry_later"
  | "locked"
  | "conflict";

export type AdvanceReelResult = {
  status: ReelPostStatus;
  done: boolean;
  /** When to call `advanceReelPost` again; null when done. */
  nextCheckInSec: number | null;
  outcome: AdvanceReelOutcome;
  errorCode: string | null;
};

const MAX_FINISH_ATTEMPTS = 2;
const MAX_STEPS = 8;

const TERMINAL: ReadonlySet<ReelPostStatus> = new Set(["posted", "failed"]);

const LOCAL_ERRORS = {
  missing_video: "FaithForm lost track of this Reel's upload. Try posting it again.",
  upload_mismatch: "The video file changed during upload. Make the clip again, then post it.",
  render_unavailable: "The clip video could not be opened. FaithForm will try again.",
  upload_failed: "Facebook could not accept the video file. Try making the clip again.",
  upload_expired: "The upload expired on Facebook before it finished. Try posting again.",
  processing_failed: "Facebook could not process this video. Try making the clip again.",
  publish_failed: "Facebook could not publish this Reel. Check the Page on Facebook, then try again.",
  facebook_failed: "Facebook could not post this Reel.",
  reconnect_required: "Facebook access expired. Reconnect Facebook in Settings.",
  unexpected: "Something went wrong while posting the Reel. FaithForm will check again.",
} as const;

function localError(
  kind: ReelProviderError["kind"],
  code: keyof typeof LOCAL_ERRORS,
): ReelProviderError {
  return new ReelProviderError({ kind, code, message: LOCAL_ERRORS[code] });
}

function nextCheckDelay(attempts: number): number {
  return Math.min(300, 15 * 2 ** Math.min(Math.max(attempts, 0), 5));
}

function skipBytes(
  body: ReadableStream<Uint8Array> | Uint8Array,
  offset: number,
): ReadableStream<Uint8Array> | Uint8Array {
  if (offset <= 0) return body;
  if (body instanceof Uint8Array) return body.subarray(offset);
  let remaining = offset;
  return body.pipeThrough(
    new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        if (remaining >= chunk.byteLength) {
          remaining -= chunk.byteLength;
          return;
        }
        controller.enqueue(remaining > 0 ? chunk.subarray(remaining) : chunk);
        remaining = 0;
      },
    }),
  );
}

type StepResult =
  | { kind: "continue"; row: ReelPostRow }
  | { kind: "result"; result: AdvanceReelResult };

type Context = {
  deps: ReelPublisherDeps;
  provider: ReelProvider;
  refreshed: boolean;
  /** Set when this call just started the upload, so no status read is needed. */
  freshUploadUrl: string | null;
  /** A status already read in this call, to avoid a second read. */
  knownStatus: ReelVideoStatus | null;
};

function result(
  row: Pick<ReelPostRow, "status">,
  outcome: AdvanceReelOutcome,
  nextCheckInSec: number | null,
  errorCode: string | null = null,
): StepResult {
  return {
    kind: "result",
    result: {
      status: row.status,
      done: TERMINAL.has(row.status),
      nextCheckInSec: TERMINAL.has(row.status) ? null : nextCheckInSec,
      outcome,
      errorCode,
    },
  };
}

function conflict(row: ReelPostRow): StepResult {
  return result(row, "conflict", 5);
}

/** Runs a provider call, refreshing the Page token once on an auth error. */
async function call<T>(ctx: Context, fn: (provider: ReelProvider) => Promise<T>): Promise<T> {
  try {
    return await fn(ctx.provider);
  } catch (error) {
    if (!isReelProviderError(error) || error.kind !== "auth") throw error;
    if (ctx.refreshed || !ctx.deps.refreshProvider) throw error;
    ctx.refreshed = true;
    const refreshed = await ctx.deps.refreshProvider();
    if (!refreshed) throw error;
    ctx.provider = refreshed;
    return fn(refreshed);
  }
}

async function fail(ctx: Context, row: ReelPostRow, error: ReelProviderError): Promise<StepResult> {
  let code = error.code;
  let message = error.message;
  if (error.kind === "auth") {
    code = "reconnect_required";
    message = LOCAL_ERRORS.reconnect_required;
    await ctx.deps.markReconnectRequired(message);
  }
  const updated = await ctx.deps.repo.update(
    row.id,
    {
      status: "failed",
      last_error_code: code,
      last_error: message.slice(0, 300),
      last_checked_at: ctx.deps.now().toISOString(),
    },
    row.status,
  );
  if (!updated) return conflict(row);
  return result(updated, "failed", null, code);
}

async function retryLater(ctx: Context, row: ReelPostRow, error: ReelProviderError): Promise<StepResult> {
  const updated = await ctx.deps.repo.update(
    row.id,
    { last_error_code: error.code, last_error: error.message.slice(0, 300) },
    row.status,
  );
  if (!updated) return conflict(row);
  return result(updated, "retry_later", error.retryAfterSec ?? 60, error.code);
}

/** Maps a provider error during a step to the right state change. */
async function handleError(ctx: Context, row: ReelPostRow, error: unknown): Promise<StepResult> {
  const err = isReelProviderError(error) ? error : localError("retryable", "unexpected");
  if (err.kind === "terminal" || err.kind === "auth") return fail(ctx, row, err);
  // Only finish is ambiguous in a way that matters, and it is handled in
  // sendFinish. Elsewhere an ambiguous answer is safe to retry.
  return retryLater(ctx, row, err);
}

async function stepStarting(ctx: Context, row: ReelPostRow): Promise<StepResult> {
  const { repo } = ctx.deps;
  await call(ctx, (p) => p.verifyPage());

  if (row.provider_video_id) {
    const updated = await repo.update(row.id, { status: "uploading" }, "starting");
    return updated ? { kind: "continue", row: updated } : conflict(row);
  }

  // A network failure here leaves the row in `starting` with no video id. If
  // Meta did create the upload session, that session is orphaned (never
  // published) and Meta expires it; we cannot learn its id, so the retry
  // starts a fresh one. Nothing is ever published from an orphan.
  const started = await call(ctx, (p) => p.startUpload());
  const updated = await repo.update(
    row.id,
    {
      status: "uploading",
      provider_video_id: started.videoId,
      last_error_code: null,
      last_error: null,
    },
    "starting",
  );
  if (!updated) return conflict(row);
  ctx.freshUploadUrl = started.uploadUrl;
  return { kind: "continue", row: updated };
}

async function stepUploading(ctx: Context, row: ReelPostRow): Promise<StepResult> {
  const videoId = row.provider_video_id;
  if (!videoId) return fail(ctx, row, localError("terminal", "missing_video"));

  let offset = 0;
  if (ctx.freshUploadUrl === null) {
    // Resuming: ask Meta how much it already has.
    const status = ctx.knownStatus ?? (await call(ctx, (p) => p.getStatus(videoId)));
    ctx.knownStatus = null;
    const state = interpretStatus(status);
    if (state === "failed") return fail(ctx, row, failureFromStatus(status));
    if (state === "published" || state === "processing") {
      // Already finished elsewhere: never finish again, just confirm.
      const updated = await ctx.deps.repo.update(row.id, { status: "needs_check" }, "uploading");
      return updated ? { kind: "continue", row: updated } : conflict(row);
    }
    if (state === "uploaded") return sendFinish(ctx, row);
    offset = uploadedBytes(status) ?? 0;
  }

  const uploadUrl = ctx.freshUploadUrl;
  let sizeMismatch = false;
  let complete = false;
  await call(ctx, async (provider) => {
    let render: ReelRender;
    try {
      render = await ctx.deps.openRender();
    } catch {
      throw localError("retryable", "render_unavailable");
    }
    if (offset > render.size) {
      sizeMismatch = true;
      return;
    }
    if (offset === render.size) {
      complete = true;
      return;
    }
    await provider.uploadBinary({
      uploadUrl,
      videoId,
      body: skipBytes(render.stream, offset),
      fileSize: render.size,
      offset,
    });
    complete = true;
  });
  if (sizeMismatch) return fail(ctx, row, localError("terminal", "upload_mismatch"));
  if (!complete) return retryLater(ctx, row, localError("retryable", "unexpected"));
  ctx.freshUploadUrl = null;
  return sendFinish(ctx, row);
}

/**
 * Moves to `finishing` (persisted first), then sends finish once.
 * Allowed from `uploading` and, for the single re-finish, `needs_check`.
 */
async function sendFinish(ctx: Context, row: ReelPostRow): Promise<StepResult> {
  const { repo, now } = ctx.deps;
  const videoId = row.provider_video_id;
  if (!videoId) return fail(ctx, row, localError("terminal", "missing_video"));
  if (row.finish_attempts >= MAX_FINISH_ATTEMPTS) {
    // Never finish a third time; leave it for a person to check.
    const updated = await repo.update(row.id, { status: "needs_check" }, row.status);
    return updated ? result(updated, "waiting", 300) : conflict(row);
  }

  const previous = row.status;
  const finishing = await repo.update(
    row.id,
    {
      status: "finishing",
      finish_attempts: row.finish_attempts + 1,
      finish_requested_at: now().toISOString(),
      last_error_code: null,
      last_error: null,
    },
    previous,
  );
  if (!finishing) return conflict(row);

  let postId: string | null;
  try {
    ({ postId } = await call(ctx, (p) => p.finish({ videoId, description: row.caption })));
  } catch (error) {
    const err = isReelProviderError(error) ? error : null;
    if (err && (err.kind === "terminal" || err.kind === "auth")) {
      return fail(ctx, finishing, err);
    }
    if (err && err.kind === "retryable") {
      // Meta answered and refused (e.g. rate limit): nothing was published,
      // so undo the attempt and try again later from the same place.
      const reverted = await repo.update(
        row.id,
        {
          status: previous,
          finish_attempts: row.finish_attempts,
          last_error_code: err.code,
          last_error: err.message.slice(0, 300),
        },
        "finishing",
      );
      if (!reverted) return conflict(finishing);
      return result(reverted, "retry_later", err.retryAfterSec ?? 60, err.code);
    }
    // Ambiguous (or unexpected): the Reel may be publishing. Check, don't resend.
    const unconfirmed = err ?? localError("ambiguous", "unexpected");
    const checking = await repo.update(
      row.id,
      {
        status: "needs_check",
        last_error_code: unconfirmed.code,
        last_error: unconfirmed.message.slice(0, 300),
      },
      "finishing",
    );
    if (!checking) return conflict(finishing);
    return result(checking, "waiting", 60, unconfirmed.code);
  }

  const processing = await repo.update(
    row.id,
    { status: "processing", provider_post_id: postId ?? null, check_attempts: 0 },
    "finishing",
  );
  return processing ? { kind: "continue", row: processing } : conflict(finishing);
}

function failureFromStatus(status: ReelVideoStatus): ReelProviderError {
  if (status.video_status === "expired") return localError("terminal", "upload_expired");
  if (status.video_status === "upload_failed" || status.uploading_phase?.status === "error") {
    return localError("terminal", "upload_failed");
  }
  if (status.processing_phase?.status === "error") return localError("terminal", "processing_failed");
  if (
    status.publishing_phase?.status === "error" ||
    status.publishing_phase?.publish_status === "error"
  ) {
    return localError("terminal", "publish_failed");
  }
  return localError("terminal", "facebook_failed");
}

async function stepChecking(ctx: Context, row: ReelPostRow): Promise<StepResult> {
  const { repo, now } = ctx.deps;
  const videoId = row.provider_video_id;
  if (!videoId) return fail(ctx, row, localError("terminal", "missing_video"));

  const status = await call(ctx, (p) => p.getStatus(videoId));
  const state = interpretStatus(status);
  const checkedAt = now();

  if (state === "published") {
    let permalink: string | null = null;
    try {
      permalink = await call(ctx, (p) =>
        p.getPermalink({ videoId, postId: row.provider_post_id }),
      );
    } catch {
      permalink = null; // A link is nice to have; the Reel is posted either way.
    }
    const posted = await repo.update(
      row.id,
      {
        status: "posted",
        permalink,
        posted_at: checkedAt.toISOString(),
        last_checked_at: checkedAt.toISOString(),
        last_error_code: null,
        last_error: null,
      },
      row.status,
    );
    return posted ? result(posted, "posted", null) : conflict(row);
  }

  if (state === "failed") return fail(ctx, row, failureFromStatus(status));

  if (row.status === "needs_check" && state === "uploading") {
    // Finish was never reached with a full file: resume the upload.
    const updated = await repo.update(row.id, { status: "uploading" }, "needs_check");
    if (!updated) return conflict(row);
    ctx.knownStatus = status;
    return { kind: "continue", row: updated };
  }

  if (row.status === "needs_check" && state === "uploaded") {
    const graceSec = ctx.deps.options?.refinishGraceSec ?? 600;
    const requestedAt = row.finish_requested_at ? Date.parse(row.finish_requested_at) : NaN;
    const waited = Number.isFinite(requestedAt)
      ? (checkedAt.getTime() - requestedAt) / 1000
      : Infinity;
    if (waited >= graceSec && row.finish_attempts < MAX_FINISH_ATTEMPTS) {
      // Uploaded, publishing never started, long after an unconfirmed finish:
      // the finish did not arrive. Re-send once, on the same video.
      return sendFinish(ctx, row);
    }
  }

  const attempts = row.check_attempts + 1;
  const updated = await repo.update(
    row.id,
    { check_attempts: attempts, last_checked_at: checkedAt.toISOString() },
    row.status,
  );
  if (!updated) return conflict(row);
  return result(updated, "waiting", nextCheckDelay(attempts));
}

async function runStep(ctx: Context, row: ReelPostRow): Promise<StepResult> {
  try {
    switch (row.status) {
      case "starting":
        return await stepStarting(ctx, row);
      case "uploading":
        return await stepUploading(ctx, row);
      case "finishing": {
        // Found mid-finish (a crash or timeout after `finishing` was saved):
        // the finish may have been sent. Confirm by status, never resend here.
        const updated = await ctx.deps.repo.update(row.id, { status: "needs_check" }, "finishing");
        return updated ? { kind: "continue", row: updated } : conflict(row);
      }
      case "processing":
      case "needs_check":
        return await stepChecking(ctx, row);
      default:
        return result(row, row.status === "posted" ? "posted" : "failed", null, row.last_error_code);
    }
  } catch (error) {
    return handleError(ctx, row, error);
  }
}

export async function advanceReelPost(
  deps: ReelPublisherDeps,
  postId: string,
): Promise<AdvanceReelResult> {
  const first = await deps.repo.load(postId);
  if (!first) throw new Error("Reel post not found");
  if (TERMINAL.has(first.status)) {
    return {
      status: first.status,
      done: true,
      nextCheckInSec: null,
      outcome: first.status === "posted" ? "posted" : "failed",
      errorCode: first.last_error_code,
    };
  }

  const locked = await deps.repo.acquireStepLock(postId, deps.options?.lockSeconds ?? 1200);
  if (!locked) {
    return { status: first.status, done: false, nextCheckInSec: 30, outcome: "locked", errorCode: null };
  }

  try {
    let row = await deps.repo.load(postId);
    if (!row) throw new Error("Reel post not found");
    const ctx: Context = {
      deps,
      provider: deps.provider,
      refreshed: false,
      freshUploadUrl: null,
      knownStatus: null,
    };
    for (let i = 0; i < MAX_STEPS; i += 1) {
      const step = await runStep(ctx, row);
      if (step.kind === "result") return step.result;
      row = step.row;
    }
    return { status: row.status, done: false, nextCheckInSec: 15, outcome: "waiting", errorCode: null };
  } finally {
    await deps.repo.releaseStepLock(postId);
  }
}

/** Creates the post (or finds the open one for this render and Page) and advances it. */
export async function startReelPost(
  deps: ReelPublisherDeps,
  input: ReelPostInsert,
): Promise<{ post: ReelPostRow; created: boolean; result: AdvanceReelResult }> {
  const { row, created } = await deps.repo.insertOnce(input);
  const advanced = await advanceReelPost(deps, row.id);
  const post = (await deps.repo.load(row.id)) ?? row;
  return { post, created, result: advanced };
}
