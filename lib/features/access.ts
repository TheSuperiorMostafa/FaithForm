import type { SupabaseClient } from "@supabase/supabase-js";

import { getChurchAuth, type ChurchAuth } from "@/lib/auth/church";
import {
  FEATURE_KEYS,
  isFeatureKey,
  type FeatureKey,
} from "@/lib/features/catalog";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type FeatureFlags = Record<FeatureKey, boolean>;

/** Every feature ships enabled; a platform admin opts an account out. */
export function defaultFeatureFlags(): FeatureFlags {
  return Object.fromEntries(
    FEATURE_KEYS.map((key) => [key, true]),
  ) as FeatureFlags;
}

function isMissingFeatureTable(message: string): boolean {
  return /church_features/i.test(message);
}

/**
 * Account-level flags for a church. Rows only exist for features a platform
 * admin has explicitly changed, so anything absent falls back to enabled.
 */
export async function getChurchFeatureFlags(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<FeatureFlags> {
  const client = supabase ?? createClient();
  const flags = defaultFeatureFlags();

  const { data, error } = await client
    .from("church_features")
    .select("feature_key, enabled")
    .eq("church_id", churchId);

  if (error) {
    // Pre-0041 environments simply behave as "everything on".
    if (!isMissingFeatureTable(error.message)) {
      console.error("getChurchFeatureFlags:", error.message);
    }
    return flags;
  }

  for (const row of data ?? []) {
    const key = row.feature_key as string;
    if (isFeatureKey(key)) {
      flags[key] = Boolean(row.enabled);
    }
  }

  return flags;
}

/**
 * One flag for one church, with no signed-in user involved.
 *
 * This is what the public surfaces use. `getFeatureAccess` answers "can this
 * member open this?", which is the wrong question for a visitor on
 * gracechurch.org or a donor on /give — there is no member. The only question
 * there is whether the church still has the feature at all.
 *
 * Reads through the service-role client because `church_features` has no anon
 * policy, and defaults to enabled so an unmigrated database or a transient
 * error never takes a church's public site down.
 */
export async function isChurchFeatureEnabled(
  churchId: string,
  key: FeatureKey,
): Promise<boolean> {
  const admin = createAdminClientOrNull();
  if (!admin) return true;

  const { data, error } = await admin
    .from("church_features")
    .select("enabled")
    .eq("church_id", churchId)
    .eq("feature_key", key)
    .maybeSingle();

  if (error) {
    if (!isMissingFeatureTable(error.message)) {
      console.error("isChurchFeatureEnabled:", error.message);
    }
    return true;
  }

  // No row means never changed, which means the catalog default: on.
  return data ? Boolean(data.enabled) : true;
}

export type FeatureAccess = {
  auth: ChurchAuth;
  /** Account-level switches set by platform admins. */
  flags: FeatureFlags;
  /** Features this specific user can actually open. */
  allowed: FeatureKey[];
};

export function resolveAllowedFeatures(
  auth: Pick<ChurchAuth, "isAdmin" | "featurePermissions">,
  flags: FeatureFlags,
): FeatureKey[] {
  return FEATURE_KEYS.filter((key) => {
    if (!flags[key]) return false;
    return auth.isAdmin || auth.featurePermissions.includes(key);
  });
}

export async function getFeatureAccess(
  supabase?: SupabaseClient,
): Promise<FeatureAccess | null> {
  const client = supabase ?? createClient();
  const auth = await getChurchAuth(client);
  if (!auth) return null;

  const flags = await getChurchFeatureFlags(auth.churchId, client);

  return { auth, flags, allowed: resolveAllowedFeatures(auth, flags) };
}

export function canAccessFeature(
  access: FeatureAccess | null,
  key: FeatureKey,
): boolean {
  if (!access) return false;
  return access.allowed.includes(key);
}

/**
 * Why a feature is unavailable — drives the message the member sees instead of
 * a generic "not found".
 */
export type FeatureBlockReason = "account_disabled" | "no_permission";

export function featureBlockReason(
  access: FeatureAccess,
  key: FeatureKey,
): FeatureBlockReason | null {
  if (!access.flags[key]) return "account_disabled";
  if (!access.allowed.includes(key)) return "no_permission";
  return null;
}
