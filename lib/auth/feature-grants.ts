import { parseFeatureKeys, type FeatureKey } from "@/lib/features/catalog";
import { createAdminClientOrNull } from "@/lib/supabase/admin";

/**
 * Where per-member grants live when `church_users.feature_permissions` does not
 * exist yet.
 *
 * Migration 0041 only partly reached production, so the column that should hold
 * these is missing and cannot be added without database credentials the app
 * does not have. Rather than leave "give this person Attendance but not
 * Follow-up" broken until someone runs a migration, grants fall back to the
 * user's `app_metadata`.
 *
 * `app_metadata` specifically, never `user_metadata`: a signed-in user can
 * write their own `user_metadata` through the normal auth API, so storing
 * permissions there would let any member grant themselves anything. Only the
 * service role can write `app_metadata`.
 *
 * A FaithForm user belongs to exactly one church — the dashboard resolves a
 * single church link per session — so a per-user key needs no church scoping.
 *
 * This is a fallback, not a second home. The column wins wherever it exists,
 * and migration 0043 adopts anything stored here on the way past.
 */
export const FEATURE_GRANTS_METADATA_KEY = "faithform_features";

export function readGrantsFromAppMetadata(
  appMetadata: Record<string, unknown> | null | undefined,
): FeatureKey[] {
  return parseFeatureKeys(appMetadata?.[FEATURE_GRANTS_METADATA_KEY]);
}

/** Returns false when there is no service role key to write with. */
export async function writeGrantsToAppMetadata(
  userId: string,
  grants: FeatureKey[],
): Promise<boolean> {
  const admin = createAdminClientOrNull();
  if (!admin) return false;

  const { data: existing } = await admin.auth.admin.getUserById(userId);

  const { error } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: {
      ...(existing?.user?.app_metadata ?? {}),
      [FEATURE_GRANTS_METADATA_KEY]: grants,
    },
  });

  if (error) {
    console.error("writeGrantsToAppMetadata:", error.message);
    return false;
  }

  return true;
}

export function isMissingFeaturePermissionsColumn(message: string): boolean {
  return /feature_permissions/i.test(message);
}
