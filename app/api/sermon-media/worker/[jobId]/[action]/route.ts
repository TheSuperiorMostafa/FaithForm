import { gunzipSync } from "node:zlib";

import { NextResponse } from "next/server";
import { z } from "zod";

import { completeRenderFromWorker, renderJobPayload } from "@/lib/sermon-media/clips";
import { bearerToken, verifyJobToken } from "@/lib/sermon-media/job-token";
import { logSermonMedia, type MediaJobRow } from "@/lib/sermon-media/jobs";
import { suggestSermonRange } from "@/lib/sermon-media/sermon-range";
import { resolveWorkerSources } from "@/lib/sermon-media/sources";
import { getTranscript, saveRangeSuggestion } from "@/lib/sermon-media/store";
import { checkTranscript, workerTranscriptSchema } from "@/lib/sermon-media/transcript";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Callbacks from the sermon media worker (docs/sermon-media/WORKER_CONTRACT.md).
 *
 * Authorized only by the job capability token, which names one job and one
 * lease. Every write additionally checks lease + attempt in SQL, so a worker
 * from a reclaimed lease, or a duplicate delivery, is told to stop (409) and
 * changes nothing. Responses carry no other church's data, and nothing here is
 * logged except ids, stages and codes.
 */
const NO_STORE = { "Cache-Control": "no-store" };
const MAX_BODY_BYTES = 16 * 1024 * 1024;
const ACTIONS = new Set(["begin", "sources", "heartbeat", "transcript", "render-result", "fail"]);

const attemptSchema = z.object({ attempt_id: z.string().uuid() });
const heartbeatSchema = attemptSchema.extend({
  stage: z.string().regex(/^[a-z_]{1,40}$/).optional(),
  progress: z.number().min(0).max(1).optional(),
});
const failSchema = attemptSchema.extend({
  code: z.string().regex(/^[a-z0-9_]{1,60}$/),
  message: z.string().max(300),
  retryable: z.boolean(),
  metrics: z.record(z.string(), z.unknown()).default({}),
});

const json = (body: unknown, status = 200) => NextResponse.json(body, { status, headers: NO_STORE });
const stale = (status: "stale" | "cancelled" = "stale") => json({ status }, 409);

async function readBody(request: Request): Promise<unknown> {
  const raw = Buffer.from(await request.arrayBuffer());
  if (raw.byteLength > MAX_BODY_BYTES) throw new Error("too_large");
  const text = request.headers.get("content-encoding") === "gzip"
    ? gunzipSync(raw, { maxOutputLength: 64 * 1024 * 1024 }).toString("utf8")
    : raw.toString("utf8");
  return text ? JSON.parse(text) : {};
}

export async function POST(request: Request, context: { params: Promise<{ jobId: string; action: string }> }) {
  const { jobId, action } = await context.params;
  if (!ACTIONS.has(action) || !/^[0-9a-f-]{36}$/i.test(jobId)) return json({ error: "Not found" }, 404);
  const capability = verifyJobToken(bearerToken(request), jobId);
  if (!capability) return json({ error: "Unauthorized" }, 401);

  let body: unknown;
  try {
    body = await readBody(request);
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  const attempt = attemptSchema.safeParse(body);
  if (!attempt.success) return json({ error: "Bad request" }, 400);
  const attemptId = attempt.data.attempt_id;

  const db = createAdminClient();
  const { data: job } = await db.from("media_jobs").select("*").eq("id", jobId).maybeSingle<MediaJobRow & { attempt_id: string | null }>();
  if (!job) return json({ error: "Not found" }, 404);
  if (job.lease_token !== capability.leaseToken) return stale(job.status === "cancelled" ? "cancelled" : "stale");

  const touch = async (stage?: string, progress?: number) => {
    const { data } = await db.rpc("touch_media_job", {
      p_job_id: jobId,
      p_lease_token: capability.leaseToken,
      p_attempt_id: attemptId,
      p_stage: stage ?? null,
      p_progress: progress ?? null,
      p_extend_seconds: 300,
    });
    return data as "ok" | "cancelled" | "stale";
  };

  switch (action) {
    case "begin": {
      const result = await touch("starting", 0);
      if (result !== "ok") return stale(result);
      logSermonMedia("job_started", { jobId, kind: job.kind, attempt: job.attempts });
      return json({ status: "ok", kind: job.kind, params: job.params });
    }

    case "heartbeat": {
      const parsed = heartbeatSchema.safeParse(body);
      if (!parsed.success) return json({ error: "Bad request" }, 400);
      const result = await touch(parsed.data.stage, parsed.data.progress);
      return result === "ok" ? json({ status: "ok" }) : stale(result);
    }

    case "sources": {
      const result = await touch();
      if (result !== "ok") return stale(result);
      const { data: recording } = await db
        .from("stream_recordings")
        .select("id, church_id, source_kind, storage_path, duration_sec, deleted_at")
        .eq("id", job.recording_id)
        .eq("church_id", job.church_id)
        .maybeSingle();
      if (!recording || recording.deleted_at) {
        await db.rpc("fail_media_job", {
          p_job_id: jobId, p_lease_token: capability.leaseToken, p_attempt_id: attemptId,
          p_error_code: "recording_deleted", p_error: "The recording was deleted.", p_retryable: false, p_metrics: {},
        });
        return stale("cancelled");
      }
      const base = {
        id: recording.id as string,
        sourceKind: (recording.source_kind === "file" ? "file" : "segments") as "file" | "segments",
        storagePath: recording.storage_path as string,
        durationSec: recording.duration_sec === null ? null : Number(recording.duration_sec),
      };
      if (job.kind === "transcribe") {
        const sources = await resolveWorkerSources(db, base);
        return json({ ...sources, language: (job.params.language as string | undefined) ?? "auto" });
      }
      const payload = await renderJobPayload(db, job, base);
      if (!payload) {
        await db.rpc("fail_media_job", {
          p_job_id: jobId, p_lease_token: capability.leaseToken, p_attempt_id: attemptId,
          p_error_code: "render_superseded", p_error: "The clip changed before this version was made.", p_retryable: false, p_metrics: {},
        });
        return stale("cancelled");
      }
      return json(payload);
    }

    case "transcript": {
      if (job.kind !== "transcribe") return json({ error: "Bad request" }, 400);
      const parsed = workerTranscriptSchema.safeParse(body);
      if (!parsed.success) {
        logSermonMedia("transcript_rejected", { jobId, reason: "schema" });
        return json({ error: "The transcript did not match the expected format." }, 422);
      }
      const problems = checkTranscript(parsed.data, parsed.data.duration_sec);
      if (problems.length > 0) {
        logSermonMedia("transcript_rejected", { jobId, reason: "structure", count: problems.length });
        return json({ error: "The transcript timing was inconsistent.", problems: problems.slice(0, 5) }, 422);
      }
      const t = parsed.data;
      const { data: version, error } = await db.rpc("commit_machine_transcript", {
        p_job_id: jobId,
        p_lease_token: capability.leaseToken,
        p_attempt_id: attemptId,
        p_language: t.language,
        p_engine: t.engine,
        p_duration_sec: t.duration_sec,
        p_segments: t.segments,
        p_gaps: t.gaps,
        p_audio_events: t.audio_events,
        p_metrics: { ...t.metrics, segments: t.segments.length },
      });
      if (error) {
        logSermonMedia("transcript_commit_failed", { jobId, error: error.message.slice(0, 120) });
        return json({ error: "Could not save" }, 500);
      }
      if (version === null) return stale();
      logSermonMedia("transcript_committed", { jobId, recordingId: job.recording_id, version, segments: t.segments.length });

      // Sermon boundaries are cheap to suggest from the words; do it now so staff
      // see a proposed range as soon as the transcript appears.
      try {
        const transcript = await getTranscript(db, job.church_id, job.recording_id, version as number);
        if (transcript) {
          const suggestion = suggestSermonRange({
            segments: transcript.segments,
            gaps: transcript.gaps,
            audioEvents: transcript.audioEvents,
            durationSec: transcript.durationSec ?? t.duration_sec,
          });
          await saveRangeSuggestion(db, job.recording_id, version as number, suggestion);
          logSermonMedia("range_suggested", { recordingId: job.recording_id, status: suggestion.status, confidence: suggestion.confidence });
        }
      } catch (err) {
        logSermonMedia("range_suggest_failed", { recordingId: job.recording_id, error: err instanceof Error ? err.message.slice(0, 120) : "unknown" });
      }
      return json({ status: "ok", version });
    }

    case "render-result": {
      if (job.kind !== "render_clip") return json({ error: "Bad request" }, 400);
      const result = await completeRenderFromWorker(db, job, capability.leaseToken, attemptId, body);
      if (result === "stale") return stale();
      if (result === "invalid") return json({ error: "The render result did not match the expected format." }, 422);
      return json({ status: "ok" });
    }

    case "fail": {
      const parsed = failSchema.safeParse(body);
      if (!parsed.success) return json({ error: "Bad request" }, 400);
      const { data: ok } = await db.rpc("fail_media_job", {
        p_job_id: jobId,
        p_lease_token: capability.leaseToken,
        p_attempt_id: attemptId,
        p_error_code: parsed.data.code,
        p_error: parsed.data.message,
        p_retryable: parsed.data.retryable,
        p_metrics: parsed.data.metrics,
      });
      if (!ok) return stale();
      const { data: after } = await db.from("media_jobs").select("status").eq("id", jobId).maybeSingle();
      if (job.kind === "render_clip" && after?.status === "failed") {
        await db.from("sermon_clip_renders").update({
          status: "failed", failure_reason: parsed.data.message, updated_at: new Date().toISOString(),
        }).eq("id", job.subject_id).in("status", ["queued", "rendering"]);
      }
      logSermonMedia("job_failed", { jobId, kind: job.kind, code: parsed.data.code, retryable: parsed.data.retryable });
      return json({ status: "ok" });
    }
  }
  return json({ error: "Not found" }, 404);
}
