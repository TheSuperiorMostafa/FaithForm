import { requireRecordingAccess } from "@/lib/sermon-media/access";
import { ok } from "@/lib/sermon-media/http";
import { getLatestJob, getSermonMediaState, publicJob } from "@/lib/sermon-media/store";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** Everything the recording page needs about sermon media, minus transcript text. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const allowed = await requireRecordingAccess(id, "view");
  if (!allowed.ok) return allowed.response;
  const { auth } = allowed.access;
  const db = createAdminClient();
  const [state, job, lessons, clips] = await Promise.all([
    getSermonMediaState(db, auth.churchId, id),
    getLatestJob(db, auth.churchId, id, "transcribe"),
    db
      .from("sermon_recording_sources")
      .select("sermon_id, input_version, needs_review, review_reason, generated_at, sermons!inner(title, status)")
      .eq("recording_id", id)
      .eq("church_id", auth.churchId)
      .order("generated_at", { ascending: false }),
    db
      .from("sermon_clips")
      .select("id, status, needs_review")
      .eq("recording_id", id)
      .eq("church_id", auth.churchId)
      .neq("status", "archived"),
  ]);
  return ok({
    state,
    job: publicJob(job),
    canPublish: auth.isAdmin,
    lessons: (lessons.data ?? []).map((row) => {
      const sermon = row.sermons as unknown as { title: string; status: string };
      return {
        sermonId: row.sermon_id,
        title: sermon.title,
        status: sermon.status,
        needsReview: row.needs_review,
        reviewReason: row.review_reason,
        stale: row.input_version < state.inputVersion,
      };
    }),
    clipCount: clips.data?.length ?? 0,
  });
}
