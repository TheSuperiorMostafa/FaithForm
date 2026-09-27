import type { SupabaseClient } from "@supabase/supabase-js";

import type { FeatureKey } from "@/lib/features/catalog";
import { createAdminClientOrNull } from "@/lib/supabase/admin";

/**
 * A public route must honor an explicit feature opt-out even when its flag read
 * fails. An absent row is the catalog default (on); a failed read is unknown
 * and cannot authorize public access.
 */
export async function isPublicFeatureEnabled(
  churchId: string,
  key: FeatureKey,
  client: SupabaseClient | null = createAdminClientOrNull(),
): Promise<boolean> {
  if (!client) return false;

  const { data, error } = await client
    .from("church_features")
    .select("enabled")
    .eq("church_id", churchId)
    .eq("feature_key", key)
    .maybeSingle();

  if (error) {
    console.error("isPublicFeatureEnabled:", error.message);
    return false;
  }
  return data ? Boolean(data.enabled) : true;
}
