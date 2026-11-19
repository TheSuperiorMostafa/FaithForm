import type { SupabaseClient } from "@supabase/supabase-js";

import { signJobToken } from "@/lib/sermon-media/job-token";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Durable job queue for sermon media (media_jobs, migration 0170).
 *
 * Enqueue is one atomic, idempotent RPC. Dispatch claims due jobs within the
 * global and per-church caps, issues each a fresh lease, and hands it to the
 * worker. If the hand-off fails the lease is given back; if the worker dies
 * the lease expires and the next dispatch reclaims it. Every worker write is
 * guarded by lease + attempt in SQL, so duplicates and overlaps are harmless.
 */
export type MediaJobKind = "transcribe" | "render_clip";

export type MediaJobRow = {
  id: string;
  church_id: string;
  recording_id: string;
  kind: MediaJobKind;
  subject_id: string;
  dedupe_key: string;
  params: Record<string, unknown>;
  source: "auto" | "manual" | "retry";
  status: "queued" | "dispatched" | "running" | "succeeded" | "failed" | "cancelled";
  stage: string | null;
  progress: number | null;
  attempts: number;
  max_attempts: number;
  lease_token: string | null;
  last_error_code: string | null;
  last_error: string | null;
  metrics: Record<string, unknown>;
  created_at: string;
  dispatched_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  updated_at: string;
};

export function logSermonMedia(event: string, fields: Record<string, unknown>): void {
  // Ids, stages, durations and codes only. Never a URL, token or transcript text.
  console.info(JSON.stringify({ msg: "sermon_media", event, ...fields }));
}

export async function enqueueMediaJob(
  input: {
    churchId: string;
    recordingId: string;
    kind: MediaJobKind;
    subjectId: string;
    dedupeKey: string;
    params?: Record<string, unknown>;
    source?: "auto" | "manual" | "retry";
    requestedBy?: string | null;
    maxAttempts?: number;
  },
  db: SupabaseClient = createAdminClient(),
): Promise<MediaJobRow> {
  const { data, error } = await db.rpc("enqueue_media_job", {
    p_church_id: input.churchId,
    p_recording_id: input.recordingId,
    p_kind: input.kind,
    p_subject_id: input.subjectId,
    p_dedupe_key: input.dedupeKey,
    p_params: input.params ?? {},
    p_source: input.source ?? "auto",
    p_requested_by: input.requestedBy ?? null,
    p_max_attempts: input.maxAttempts ?? 3,
  });
  if (error) throw new Error(`enqueue_media_job failed: ${error.message}`);
  const job = data as MediaJobRow;
  logSermonMedia("job_enqueued", { jobId: job.id, kind: job.kind, churchId: job.church_id, source: job.source });
  return job;
}

/**
 * Queues transcription for a recording at its current verified revision,
 * unless that revision already has a transcript or a live job.
 */
export async function enqueueTranscription(
  input: {
    churchId: string;
    recordingId: string;
    revision: number;
    language: string;
    source: "auto" | "manual" | "retry";
    requestedBy?: string | null;
    force?: boolean;
  },
  db: SupabaseClient = createAdminClient(),
): Promise<{ job: MediaJobRow | null; skipped?: "already_transcribed" }> {
  if (!input.force) {
    const { data } = await db
      .from("media_jobs")
      .select("id")
      .eq("recording_id", input.recordingId)
      .eq("kind", "transcribe")
      .eq("status", "succeeded")
      .contains("params", { revision: input.revision })
      .limit(1);
    if (data && data.length > 0) return { job: null, skipped: "already_transcribed" };
  }
  const job = await enqueueMediaJob(
    {
      churchId: input.churchId,
      recordingId: input.recordingId,
      kind: "transcribe",
      subjectId: input.recordingId,
      dedupeKey: `transcribe:${input.recordingId}`,
      params: { revision: input.revision, language: input.language },
      source: input.source,
      requestedBy: input.requestedBy ?? null,
    },
    db,
  );
  return { job };
}

export async function requestJobCancel(jobId: string, churchId: string, db = createAdminClient()): Promise<void> {
  await db
    .from("media_jobs")
    .update({ cancel_requested_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", jobId)
    .eq("church_id", churchId)
    .in("status", ["queued", "dispatched", "running"]);
}

export async function cancelRecordingJobs(recordingId: string, db = createAdminClient()): Promise<void> {
  await db
    .from("media_jobs")
    .update({ cancel_requested_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("recording_id", recordingId)
    .in("status", ["queued", "dispatched", "running"]);
}

export type WorkerSubmitter = (input: {
  jobId: string;
  kind: MediaJobKind;
  callbackBase: string;
  jobToken: string;
}) => Promise<{ callId: string }>;

/** Submits to the Modal web endpoint (proxy-auth protected). */
export const modalSubmitter: WorkerSubmitter = async (input) => {
  const url = process.env.SERMON_MEDIA_WORKER_URL;
  const key = process.env.MODAL_PROXY_TOKEN_ID;
  const secret = process.env.MODAL_PROXY_TOKEN_SECRET;
  if (!url || !key || !secret) throw new Error("The sermon media worker is not configured.");
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Modal-Key": key, "Modal-Secret": secret },
    body: JSON.stringify({
      job_id: input.jobId,
      kind: input.kind,
      callback_base: input.callbackBase,
      job_token: input.jobToken,
    }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Worker submit returned ${response.status}.`);
  const body = (await response.json()) as { call_id?: string };
  if (!body.call_id) throw new Error("Worker submit returned no call id.");
  return { callId: body.call_id };
};

export function workerCallbackBase(jobId: string): string {
  const origin = (process.env.SERMON_MEDIA_CALLBACK_ORIGIN ?? process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  if (!/^https?:\/\//.test(origin)) throw new Error("SERMON_MEDIA_CALLBACK_ORIGIN is not configured.");
  return `${origin}/api/sermon-media/worker/${jobId}`;
}

export function globalCap(kind: MediaJobKind): number {
  const raw = Number(
    kind === "transcribe" ? process.env.SERMON_MEDIA_GLOBAL_CAP ?? 10 : process.env.SERMON_MEDIA_RENDER_CAP ?? 10,
  );
  return Number.isInteger(raw) && raw >= 1 && raw <= 100 ? raw : 10;
}

/** Claims and hands off due jobs. Safe to run concurrently (SQL serializes claims). */
export async function dispatchDueJobs(
  options: { kinds?: MediaJobKind[]; submit?: WorkerSubmitter; db?: SupabaseClient } = {},
): Promise<{ dispatched: number; failed: number }> {
  const db = options.db ?? createAdminClient();
  const submit = options.submit ?? modalSubmitter;
  let dispatched = 0;
  let failed = 0;
  for (const kind of options.kinds ?? (["transcribe", "render_clip"] as MediaJobKind[])) {
    const { data, error } = await db.rpc("claim_media_jobs", {
      p_kind: kind,
      p_global_cap: globalCap(kind),
      p_limit: 25,
      p_lease_seconds: 900,
    });
    if (error) throw new Error(`claim_media_jobs failed: ${error.message}`);
    for (const job of (data ?? []) as MediaJobRow[]) {
      const lease = job.lease_token as string;
      const queuedMs = Date.now() - new Date(job.created_at).getTime();
      try {
        const { callId } = await submit({
          jobId: job.id,
          kind,
          callbackBase: workerCallbackBase(job.id),
          jobToken: signJobToken({ jobId: job.id, leaseToken: lease }),
        });
        await db.rpc("mark_media_job_dispatch", {
          p_job_id: job.id,
          p_lease_token: lease,
          p_dispatch_ref: callId,
          p_error: null,
        });
        dispatched += 1;
        logSermonMedia("job_dispatched", { jobId: job.id, kind, attempt: job.attempts, queueAgeMs: queuedMs });
      } catch (err) {
        const message = err instanceof Error ? err.message.slice(0, 200) : "dispatch failed";
        await db.rpc("mark_media_job_dispatch", {
          p_job_id: job.id,
          p_lease_token: lease,
          p_dispatch_ref: null,
          p_error: message,
        });
        failed += 1;
        logSermonMedia("job_dispatch_failed", { jobId: job.id, kind, error: message });
      }
    }
  }
  return { dispatched, failed };
}

/** Best effort: start work now instead of on the next cron tick. */
export async function kickDispatch(kinds: MediaJobKind[]): Promise<void> {
  try {
    await dispatchDueJobs({ kinds });
  } catch (err) {
    logSermonMedia("dispatch_kick_failed", { error: err instanceof Error ? err.message.slice(0, 200) : "unknown" });
  }
}
