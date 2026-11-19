import { z } from "zod";

import { fail, limit, ok, readJson, requireClipAccess, routeError } from "@/lib/sermon-media/http";
import { approveClip, setClipDecision } from "@/lib/sermon-media/studio";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const approveSchema = z.object({
  renderId: z.string().uuid(),
  /** The final video the person watched. */
  specHash: z.string().regex(/^[a-f0-9]{64}$/),
  caption: z.string().max(2200),
  /** "I watched this video. It's OK to share publicly." */
  reviewed: z.literal(true),
  /** Post within a minute instead of at the next scheduled time. */
  postNow: z.boolean().optional(),
});

/** One-tap approval: schedule the watched video to post (church admins). */
export async function POST(request: Request, context: { params: Promise<{ clipId: string }> }) {
  const { clipId } = await context.params;
  const allowed = await requireClipAccess(clipId, "publish");
  if (!allowed.ok) return allowed.response;
  const parsed = approveSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, "Watch the video and confirm it's OK to share before approving.");
  const { auth } = allowed.access;
  const limited = await limit(`sermon-media-approve:${auth.churchId}`, 120);
  if (limited) return limited;
  try {
    const result = await approveClip(createAdminClient(), {
      clip: allowed.clip,
      churchId: auth.churchId,
      churchTimezone: auth.churchTimezone,
      userId: auth.userId,
      renderId: parsed.data.renderId,
      specHash: parsed.data.specHash,
      caption: parsed.data.caption,
      postNow: Boolean(parsed.data.postNow),
    });
    return ok(result);
  } catch (error) {
    return routeError(error, "We couldn't approve that clip. Please try again.", "approve");
  }
}

const decisionSchema = z.object({ decision: z.enum(["skip", "unschedule", "restore"]) });

/** Skip a clip, take an approved clip off the schedule, or bring a skipped clip back (to review). */
export async function PATCH(request: Request, context: { params: Promise<{ clipId: string }> }) {
  const { clipId } = await context.params;
  const allowed = await requireClipAccess(clipId, "edit");
  if (!allowed.ok) return allowed.response;
  const parsed = decisionSchema.safeParse(await readJson(request));
  if (!parsed.success) return fail(400, "We couldn't read that request.");
  if (parsed.data.decision === "unschedule" && !allowed.access.auth.isAdmin) {
    return fail(403, "Only a church administrator can change the posting schedule.");
  }
  const changed = await setClipDecision(createAdminClient(), allowed.clip, parsed.data.decision);
  if (!changed) return fail(409, "This clip already changed. Reload to see where it is.");
  return ok({ done: true });
}
