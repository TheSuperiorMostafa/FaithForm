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
    // Reads tolerate a missing table by treating every feature as on, so the
    // absence of migration 0041 stays invisible until someone tries to switch
    // one off. Say which migration, rather than passing on PostgREST's
    // "schema cache" wording, which sounds like a caching blip.
    if (/church_features/i.test(error.message)) {
      return {
        ok: false,
        error:
          "Feature flags aren't set up in this database yet — migration 0041 hasn't been applied. Run `pnpm db:team-access`.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath(`/admin/churches/${churchId}`);
  // The church's own dashboard reads these flags for nav and route guards.
  revalidatePath("/dashboard", "layout");

  return { ok: true };
}
