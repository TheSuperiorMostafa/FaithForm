"use server";

import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/superadmin";
import { isFeatureKey } from "@/lib/features/catalog";
import { createAdminClient } from "@/lib/supabase/admin";

export type FeatureToggleResult = { ok: true } | { ok: false; error: string };

/**
 * Turns a product area on or off for one church.
 *
 * Rows are only written for features that have been explicitly changed —
 * anything absent falls back to the catalog default (enabled), so adding a
 * feature to the catalog does not require backfilling every account.
 */
export async function setChurchFeature(
  churchId: string,
  featureKey: string,
  enabled: boolean,
): Promise<FeatureToggleResult> {
  const user = await requireSuperAdmin();

  if (!churchId) return { ok: false, error: "Missing church." };
  if (!isFeatureKey(featureKey)) {
    return { ok: false, error: "Unknown feature." };
  }

  const admin = createAdminClient();
  const { error } = await admin.from("church_features").upsert(
    {
      church_id: churchId,
      feature_key: featureKey,
      enabled,
      updated_at: new Date().toISOString(),
      updated_by: user.id,
    },
    { onConflict: "church_id,feature_key" },
  );

  if (error) {
    return { ok: false, error: error.message };
  }

  revalidatePath(`/admin/churches/${churchId}`);
  // The church's own dashboard reads these flags for nav and route guards.
  revalidatePath("/dashboard", "layout");

  return { ok: true };
}
