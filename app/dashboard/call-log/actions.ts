"use server";

import { revalidatePath } from "next/cache";
import { isMissingHandledColumn } from "@/app/dashboard/call-log/handled";
import { requireChurchAuth } from "@/lib/auth/church";
import { toUserError } from "@/lib/errors/user-error";
import { featureActionError } from "@/lib/features/guard";
import { createAdminClient } from "@/lib/supabase/admin";

export type MarkCallHandledResult =
  | { ok: true; handledAt: string | null }
  | { ok: false; error: string };

const NOT_SET_UP =
  "Marking calls handled isn't set up for your church yet. Please contact FaithForm support.";

/**
 * Marks a call handled, or puts it back on the "Needs a call back" list.
 *
 * Church admins only, the same people the `phone_calls_update` policy lets
 * write. The service client is used so a FaithForm admin stepping into the
 * church can do it too; the church predicate is on the statement itself, so a
 * call id from another church matches nothing.
 */
export async function markCallHandledAction(
  callId: string,
  handled: boolean,
): Promise<MarkCallHandledResult> {
  try {
    const auth = await requireChurchAuth();

    const denied = await featureActionError("voice_assistant");
    if (denied) return { ok: false, error: denied };

    if (!auth.isAdmin) {
      return { ok: false, error: "Only church admins can mark calls handled." };
    }

    const handledAt = handled ? new Date().toISOString() : null;
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("phone_calls")
      .update({
        handled_at: handledAt,
        handled_by: handled ? auth.userId : null,
      })
      .eq("id", callId)
      .eq("church_id", auth.churchId)
      .select("id")
      .maybeSingle();

    if (error) {
      if (isMissingHandledColumn(error)) return { ok: false, error: NOT_SET_UP };
      return { ok: false, error: toUserError(error, "We couldn't update this call.") };
    }
    if (!data) {
      return { ok: false, error: "We couldn't find that call. Refresh the page and try again." };
    }

    revalidatePath("/dashboard/call-log");
    revalidatePath(`/dashboard/call-log/${callId}`);
    return { ok: true, handledAt };
  } catch (error) {
    return { ok: false, error: toUserError(error, "We couldn't update this call.") };
  }
}
