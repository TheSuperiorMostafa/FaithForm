"use server";

import { after } from "next/server";
import { toUserError, UserFacingError } from "@/lib/errors/user-error";
import { notifyAnswer, recordAnswer, type Answer } from "@/lib/service-plans/attendance";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import { loadSharedPlanByToken } from "./load";

/**
 * "I'll be there" / "Can't make it" from a share link. Public by design: the
 * token is the credential, and it is checked (hash, expiry, revocation) before
 * anything is written. Only a personal link answers, and only for its person.
 */
export async function answerPlanAction(
  token: string,
  status: Answer,
): Promise<{ ok: true; status: Answer } | { ok: false; error: string }> {
  try {
    if (status !== "confirmed" && status !== "declined") throw new UserFacingError("Pick one of the two answers.");
    const loaded = typeof token === "string" ? await loadSharedPlanByToken(token) : null;
    if (!loaded) throw new UserFacingError("This link isn’t working any more. Ask whoever sent it for a new one.");
    const { share, plan, church } = loaded;
    if (!share.person_id) {
      throw new UserFacingError("This link is shared with a group, so it can’t answer for one person. Use the link sent to you.");
    }
    const admin = createAdminClientOrNull();
    if (!admin) throw new Error("Service role unavailable");

    const previous = await recordAnswer(admin, share, status);
    if (previous !== status) {
      // After the response: the person sees their answer straight away, and a
      // slow email or text never holds them up.
      after(() => notifyAnswer({ admin, share, plan, churchName: church.name, status, previous }));
    }
    return { ok: true, status };
  } catch (error) {
    return { ok: false, error: toUserError(error, "We couldn’t save your answer. Please try again.") };
  }
}
