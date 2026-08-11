import { getAuthUsersByIds } from "@/lib/auth/auth-users";
import { readGrantsFromAppMetadata } from "@/lib/auth/feature-grants";
import { parseFeatureKeys, type FeatureKey } from "@/lib/features/catalog";
import { createAdminClientOrNull } from "@/lib/supabase/admin";

export type TeamRole = "admin" | "viewer";

export type TeamMember = {
  /** church_users row id */
  id: string;
  userId: string;
  email: string | null;
  role: TeamRole;
  featurePermissions: FeatureKey[];
  joinedAt: string;
  invitedAt: string | null;
  lastSignInAt: string | null;
  /** False until the invitee signs in for the first time. */
  hasSignedIn: boolean;
};

type ChurchUserRow = {
  id: string;
  user_id: string;
  role: string;
  created_at: string;
  feature_permissions?: unknown;
  invited_at?: string | null;
};

const MEMBER_COLUMNS =
  "id, user_id, role, created_at, feature_permissions, invited_at";
const MEMBER_COLUMNS_LEGACY = "id, user_id, role, created_at";

export function toTeamRole(value: string | null | undefined): TeamRole {
  return value === "admin" ? "admin" : "viewer";
}

/**
 * Roster for one church. Uses the service-role client because member emails
 * live in `auth.users`, which is not readable under RLS — callers must verify
 * the requester belongs to `churchId` first.
 */
export async function getChurchTeamMembers(
  churchId: string,
): Promise<TeamMember[]> {
  const admin = createAdminClientOrNull();
  if (!admin) {
    console.error("getChurchTeamMembers: service role key is not configured");
    return [];
  }

  const load = (columns: string) =>
    admin
      .from("church_users")
      .select(columns)
      .eq("church_id", churchId)
      .order("created_at", { ascending: true });

  let legacySchema = false;
  let { data, error } = await load(MEMBER_COLUMNS);

  // Tolerate a database that has not had migration 0041 applied yet — grants
  // are read from each member's app_metadata instead.
  if (error && /feature_permissions|invited_at/i.test(error.message)) {
    legacySchema = true;
    ({ data, error } = await load(MEMBER_COLUMNS_LEGACY));
  }

  if (error) {
    console.error("getChurchTeamMembers:", error.message);
    return [];
  }

  const rows = (data as unknown as ChurchUserRow[] | null) ?? [];
  const authUsers = await getAuthUsersByIds(rows.map((row) => row.user_id));

  return rows.map((row) => {
    const authUser = authUsers.get(row.user_id);
    return {
      id: row.id,
      userId: row.user_id,
      email: authUser?.email ?? null,
      role: toTeamRole(row.role),
      featurePermissions: legacySchema
        ? readGrantsFromAppMetadata(authUser?.appMetadata)
        : parseFeatureKeys(row.feature_permissions),
      joinedAt: row.created_at,
      invitedAt: row.invited_at ?? null,
      lastSignInAt: authUser?.lastSignInAt ?? null,
      hasSignedIn: Boolean(authUser?.lastSignInAt),
    };
  });
}

/**
 * Whether grants are stored in their proper column.
 *
 * False means migration 0041 never fully landed and grants are living in each
 * member's `app_metadata` instead. Everything works either way; this only
 * drives a note telling the operator the schema is behind.
 */
export async function usesFeaturePermissionsColumn(): Promise<boolean> {
  const admin = createAdminClientOrNull();
  if (!admin) return false;

  const { error } = await admin
    .from("church_users")
    .select("feature_permissions", { head: true, count: "exact" })
    .limit(1);

  return !error;
}

/** How many admins the church has — used to block removing the last one. */
export async function countChurchAdmins(churchId: string): Promise<number> {
  const admin = createAdminClientOrNull();
  if (!admin) return 0;

  const { count, error } = await admin
    .from("church_users")
    .select("id", { count: "exact", head: true })
    .eq("church_id", churchId)
    .eq("role", "admin");

  if (error) {
    console.error("countChurchAdmins:", error.message);
    return 0;
  }

  return count ?? 0;
}
