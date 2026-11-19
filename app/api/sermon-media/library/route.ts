import { requireStudioAccess } from "@/lib/sermon-media/access";
import { ok } from "@/lib/sermon-media/http";
import type { MediaJobRow } from "@/lib/sermon-media/jobs";
import { publicJob } from "@/lib/sermon-media/store";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 25;

/**
 * Transcripts section: every service recording and uploaded video, newest
 * first, with transcript status, live progress, sermon range and clip counts.
 */
export async function GET(request: Request) {
  const allowed = await requireStudioAccess("view");
  if (!allowed.ok) return allowed.response;
  const { auth } = allowed.access;
  const url = new URL(request.url);
  const page = Math.max(1, Number(url.searchParams.get("page")) || 1);
  const query = (url.searchParams.get("q") ?? "").trim().slice(0, 80);
  const db = createAdminClient();

  let q = db
    .from("stream_recordings")
    .select("id, title, source_kind, status, duration_sec, created_at, ready_at, service_date", { count: "exact" })
    .eq("church_id", auth.churchId)
    .is("deleted_at", null)
    .in("status", ["processing", "ready", "published", "failed"])
    .order("created_at", { ascending: false })
    .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);
  if (query) q = q.ilike("title", `%${query.replace(/[%_]/g, "")}%`);
  const { data: recordings, count } = await q;
  const ids = (recordings ?? []).map((row) => row.id as string);
  if (ids.length === 0) return ok({ items: [], total: count ?? 0, page, pageSize: PAGE_SIZE });

  const [states, jobs, clips] = await Promise.all([
    db
      .from("recording_sermon_media")
      .select("recording_id, current_transcript_version, suggestion_status, confirmed_start_sec, confirmed_end_sec, confirmed_automatically")
      .in("recording_id", ids),
    db
      .from("media_jobs")
      .select("*")
      .eq("church_id", auth.churchId)
      .eq("kind", "transcribe")
      .in("recording_id", ids)
      .order("created_at", { ascending: false }),
    db
      .from("sermon_clips")
      .select("recording_id, approval_status")
      .eq("church_id", auth.churchId)
      .in("recording_id", ids)
      .neq("status", "archived"),
  ]);
  const stateBy = new Map((states.data ?? []).map((row) => [row.recording_id as string, row]));
  const jobBy = new Map<string, MediaJobRow>();
  for (const job of (jobs.data ?? []) as MediaJobRow[]) if (!jobBy.has(job.recording_id)) jobBy.set(job.recording_id, job);
  const clipCounts = new Map<string, { total: number; waiting: number; scheduled: number; posted: number }>();
  for (const clip of clips.data ?? []) {
    const c = clipCounts.get(clip.recording_id as string) ?? { total: 0, waiting: 0, scheduled: 0, posted: 0 };
    c.total += 1;
    if (clip.approval_status === "pending") c.waiting += 1;
    if (clip.approval_status === "approved") c.scheduled += 1;
    if (clip.approval_status === "posted") c.posted += 1;
    clipCounts.set(clip.recording_id as string, c);
  }

  const items = (recordings ?? []).map((row) => {
    const state = stateBy.get(row.id as string);
    const job = jobBy.get(row.id as string) ?? null;
    const durationSec = row.duration_sec === null ? null : Number(row.duration_sec);
    return {
      id: row.id,
      title: row.title,
      source: row.source_kind === "file" ? "upload" : "livestream",
      recordingStatus: row.status,
      durationSec,
      createdAt: row.created_at,
      serviceDate: (row as { service_date?: string | null }).service_date ?? null,
      transcript: state?.current_transcript_version ? "ready" : job ? job.status : "none",
      job: publicJob(job, durationSec ?? 0),
      sermon: state?.confirmed_start_sec !== null && state?.confirmed_start_sec !== undefined
        ? {
            startSec: Number(state.confirmed_start_sec),
            endSec: Number(state.confirmed_end_sec),
            automatic: Boolean(state.confirmed_automatically),
          }
        : null,
      suggestion: state?.suggestion_status ?? "none",
      clips: clipCounts.get(row.id as string) ?? { total: 0, waiting: 0, scheduled: 0, posted: 0 },
    };
  });
  return ok({ items, total: count ?? items.length, page, pageSize: PAGE_SIZE });
}
