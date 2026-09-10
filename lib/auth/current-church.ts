import type { SupabaseClient } from "@supabase/supabase-js";

import { getActiveImpersonation } from "@/lib/auth/impersonation";
import { getCurrentChurchId as getMembershipChurchId } from "@/lib/queries/dashboard";

/**
 * The church a signed-in person is working in right now.
 *
 * A platform admin working inside a church is answered with that church. The
 * plain membership lookup gave them the first church they belong to instead,
 * so announcements, sermons and attendance they saved while inside a church
 * landed on their own account.
 *
 * Server only, because it reads the cookie jar. That is also why it is not in
 * lib/queries/dashboard.ts: client components import from there, and even a
 * lazy import of cookie code breaks their bundle.
 */
export async function getCurrentChurchId(
  supabase: SupabaseClient,
  userId: string,
): Promise<string | null> {
  const acting = await getActiveImpersonation();
  if (acting && acting.adminUserId === userId) return acting.churchId;
  return getMembershipChurchId(supabase, userId);
}
