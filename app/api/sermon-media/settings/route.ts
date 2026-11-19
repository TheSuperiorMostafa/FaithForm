import { z } from "zod";

import { requireStudioAccess } from "@/lib/sermon-media/access";
import { fail, ok, readJson, routeError } from "@/lib/sermon-media/http";
import { postScheduleSchema } from "@/lib/sermon-media/schedule";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

/** How the studio runs for this church. */
export async function GET() {
  const allowed = await requireStudioAccess("view");
  if (!allowed.ok) return allowed.response;
  const { settings, auth } = allowed.access;
  return ok({
    settings: {
      autoTranscribe: settings.autoTranscribe,
      autoConfirmRange: settings.autoConfirmRange,
      autoClips: settings.autoClips,
      clipsPerService: settings.clipsPerService,
      language: settings.language,
      postSchedule: settings.postSchedule,
    },
    timezone: auth.churchTimezone,
    canEdit: auth.isAdmin,
  });
}

const patchSchema = z.object({
  autoTranscribe: z.boolean().optional(),
  autoConfirmRange: z.boolean().optional(),
  autoClips: z.boolean().optional(),
  clipsPerService: z.number().int().min(0).max(6).optional(),
  language: z.string().regex(/^(auto|[a-z]{2})$/).optional(),
  postSchedule: postScheduleSchema.optional(),
});

export async function PATCH(request: Request) {
  const allowed = await requireStudioAccess("admin");
  if (!allowed.ok) return allowed.response;
  const { auth, settings } = allowed.access;
  const parsed = patchSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, "We couldn't read those settings.");
  const next = { ...settings, ...parsed.data };
  try {
    const { error } = await createAdminClient()
      .from("sermon_media_settings")
      .upsert({
        church_id: auth.churchId,
        enabled: true,
        auto_transcribe: next.autoTranscribe,
        auto_confirm_range: next.autoConfirmRange,
        auto_clips: next.autoClips,
        clips_per_service: next.clipsPerService,
        language: next.language,
        post_schedule: next.postSchedule,
        updated_by: auth.userId,
        updated_at: new Date().toISOString(),
      });
    if (error) throw error;
    return ok({ saved: true });
  } catch (error) {
    return routeError(error, "We couldn't save those settings. Please try again.", "studio_settings");
  }
}
