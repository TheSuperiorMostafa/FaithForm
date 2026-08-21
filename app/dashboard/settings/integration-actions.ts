"use server";

import { revalidatePath } from "next/cache";
import { getChurchAuth } from "@/lib/auth/church";
import { deleteIntegration } from "@/lib/integrations/tokens";
import { createClient } from "@/lib/supabase/server";
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

  if (!auth) return { error: "No church linked" };
  if (!auth.isAdmin) {
    return { error: "Only church admins can change integrations." };
  }
  if (!DISCONNECTABLE.includes(provider as IntegrationProvider)) {
    return { error: "Unknown integration." };
  }

  await deleteIntegration(
    auth.churchId,
    provider as IntegrationProvider,
    supabase,
  );

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard/live-streaming");
  revalidatePath("/dashboard/announcements");
  return { success: true };
}
