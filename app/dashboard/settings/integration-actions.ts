"use server";

import { revalidatePath } from "next/cache";
import { getChurchAuth } from "@/lib/auth/church";
import { deleteIntegration } from "@/lib/integrations/tokens";
import { createClient } from "@/lib/supabase/server";
import { toUserError } from "@/lib/errors/user-error";
import type { IntegrationProvider } from "@/lib/integrations/types";

/** Providers an admin can connect and disconnect from Settings. */
const DISCONNECTABLE: IntegrationProvider[] = [
  "google",
  "facebook",
  "youtube",
  "apple",
];

/**
 * Removes a connection at the admin's explicit request.
 *
 * This is the only path that deletes an integration row. Token-refresh
 * failures deliberately do not — they flag the row for reconnect so the
 * channel, Page and calendar selections survive a transient outage.
 */
export async function disconnectIntegrationAction(provider: string) {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);

  if (!auth) return { error: "Your account isn't connected to a church yet." };
  if (!auth.isAdmin) {
    return { error: "Only church admins can change connected accounts." };
  }
  if (!DISCONNECTABLE.includes(provider as IntegrationProvider)) {
    return { error: "We don't recognise that account. Refresh the page and try again." };
  }

  try {
    await deleteIntegration(
      auth.churchId,
      provider as IntegrationProvider,
      supabase,
    );
  } catch (error) {
    return { error: toUserError(error, "We couldn't disconnect that account.") };
  }

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/live-streaming");
  revalidatePath("/dashboard/announcements");
  return { success: true };
}
