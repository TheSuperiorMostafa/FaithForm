import "server-only";

import { getFeatureAccess } from "@/lib/features/access";
import { pendingWhatsNew, type PendingWhatsNew } from "@/lib/releases/pending";
import { RELEASES } from "@/lib/releases/whats-new";
import { createClient } from "@/lib/supabase/server";

/**
 * The release this signed-in staff member should see, or null.
 *
 * Reads their dismissals with their own session, so row-level security keeps
 * it to their rows. A platform admin visiting a church never gets the pop-up:
 * it is the church's team's news, and their dismissal is not the church's.
 * Any failed read, including before migration 0178 is applied, shows nothing
 * rather than a pop-up that could never be dismissed.
 *
 * To look at the pop-up locally without signing in, open /dev-whats-new-preview.
 */
export async function getPendingWhatsNew(): Promise<PendingWhatsNew | null> {
  const access = await getFeatureAccess();
  if (!access || access.auth.impersonation) return null;

  // Nothing recent for this person means no read at all on most page loads.
  const candidate = pendingWhatsNew(RELEASES, access.allowed, new Set());
  if (!candidate) return null;

  const { data, error } = await createClient()
    .from("whats_new_reads")
    .select("item_id")
    .eq("user_id", access.auth.userId)
    .in("item_id", candidate.itemIds);

  if (error) {
    if (!/whats_new_reads/i.test(error.message)) console.error("getPendingWhatsNew:", error.message);
    return null;
  }

  const seen = new Set((data ?? []).map((row) => row.item_id as string));
  return pendingWhatsNew(RELEASES, access.allowed, seen);
}
