import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import {
  isMissingFeaturePermissionsColumn,
  readGrantsFromAppMetadata,
} from "@/lib/auth/feature-grants";
import { parseFeatureKeys, type FeatureKey } from "@/lib/features/catalog";

export type ChurchAuth = {
  userId: string;
  churchId: string;
  role: string;
  isAdmin: boolean;
  /**
   * Explicit per-feature grants for this member. Church admins hold every
   * feature implicitly, so this is only consulted for non-admins.
   */
  featurePermissions: FeatureKey[];
};

type ChurchUserLink = {
  church_id: string;
  role: string;
  feature_permissions?: unknown;
  /** True when the row came from the pre-0041 column set. */
  __legacy?: boolean;
};

const LINK_COLUMNS = "church_id, role, feature_permissions";
const LINK_COLUMNS_LEGACY = "church_id, role";

async function fetchChurchUserLink(
  client: SupabaseClient,
  userId: string,
): Promise<{ data: ChurchUserLink | null; error: { message: string } | null }> {
  const query = (columns: string) =>
    client
      .from("church_users")
      .select(columns)
      .eq("user_id", userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();

  const { data, error } = await query(LINK_COLUMNS);

  // Tolerate the pre-0041 schema so an un-migrated environment still signs in.
  // The caller then reads grants from app_metadata instead.
  if (error && isMissingFeaturePermissionsColumn(error.message)) {
    const legacy = await query(LINK_COLUMNS_LEGACY);
    const row = (legacy.data as ChurchUserLink | null) ?? null;
    return {
      data: row ? { ...row, __legacy: true } : null,
      error: legacy.error,
    };
  }

  return { data: (data as ChurchUserLink | null) ?? null, error };
}

export async function getChurchAuth(
  supabase?: SupabaseClient,
): Promise<ChurchAuth | null> {
  const client = supabase ?? createClient();
  const {
    data: { user },
  } = await client.auth.getUser();

  if (!user) return null;

  const { data: link, error } = await fetchChurchUserLink(client, user.id);

  if (error) {
    console.error("getChurchAuth church_users:", error.message);
  }

  let resolvedLink = link;
  if (!resolvedLink?.church_id && process.env.NODE_ENV !== "production") {
    const admin = createAdminClientOrNull();
    if (admin) {
      const { data: adminLink, error: adminError } = await fetchChurchUserLink(
        admin,
        user.id,
      );

      if (adminError) {
        console.error("getChurchAuth admin church_users:", adminError.message);
      }

      resolvedLink = adminLink;
    }
  }

  if (!resolvedLink?.church_id) return null;

  const role = resolvedLink.role as string;

  // `user` already carries app_metadata from the session lookup, so the
  // fallback costs no extra round trip.
  const featurePermissions = resolvedLink.__legacy
    ? readGrantsFromAppMetadata(
        user.app_metadata as Record<string, unknown> | null,
      )
    : parseFeatureKeys(resolvedLink.feature_permissions);

  return {
    userId: user.id,
    churchId: resolvedLink.church_id as string,
    role,
    isAdmin: role === "admin",
    featurePermissions,
  };
}

export async function requireChurchAuth(): Promise<ChurchAuth> {
  const auth = await getChurchAuth();
  if (!auth) {
    throw new Error("Unauthorized");
  }
  return auth;
}
