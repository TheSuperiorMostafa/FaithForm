"use server";

import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/superadmin";
import { isFeatureKey } from "@/lib/features/catalog";
import {
  isDisabledReason,
  type DisabledReason,
} from "@/lib/features/disabled-reason";
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
  disabled?: { reason: DisabledReason; note?: string | null },
): Promise<FeatureToggleResult> {
  const user = await requireSuperAdmin();

  if (!churchId) return { ok: false, error: "Missing church." };
  if (!isFeatureKey(featureKey)) {
    return { ok: false, error: "Unknown feature." };
  }

  if (!enabled && disabled && !isDisabledReason(disabled.reason)) {
    return { ok: false, error: "Pick a reason for switching this off." };
  }

  const note = disabled?.note?.trim() ?? "";
  if (!enabled && disabled?.reason === "custom" && !note) {
    return { ok: false, error: "Write the message the church should see." };
  }

  const admin = createAdminClient();

  const row: Record<string, unknown> = {
    church_id: churchId,
    feature_key: featureKey,
    enabled,
    updated_at: new Date().toISOString(),
    updated_by: user.id,
    // Switching a feature back on clears the reason, so the next time it goes
    // off it cannot inherit a stale explanation.
    disabled_reason: enabled ? null : (disabled?.reason ?? null),
    disabled_note: enabled || disabled?.reason !== "custom" ? null : note,
  };

  let { error } = await admin
    .from("church_features")
    .upsert(row, { onConflict: "church_id,feature_key" });

  // Pre-0049 databases hold the switch but not the reason. Keep the toggle
  // working there rather than blocking it on an unapplied migration.
  if (error && /disabled_reason|disabled_note/i.test(error.message)) {
    delete row.disabled_reason;
    delete row.disabled_note;
    ({ error } = await admin
      .from("church_features")
      .upsert(row, { onConflict: "church_id,feature_key" }));
  }

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
