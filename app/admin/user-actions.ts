"use server";

import { revalidatePath } from "next/cache";

import { requireSuperAdmin } from "@/lib/auth/superadmin";
import { writeGrantsToAppMetadata } from "@/lib/auth/feature-grants";
import { getChurchFeatureFlags } from "@/lib/features/access";
import { FEATURE_KEYS, isFeatureKey, type FeatureKey } from "@/lib/features/catalog";
import { createAdminClient } from "@/lib/supabase/admin";

export type AdminUserActionState = {
  ok: boolean;
  message?: string;
  error?: string;
};

export const initialAdminUserState: AdminUserActionState = { ok: false };

function isMissingFeaturePermissionsColumn(message: string): boolean {
  return /feature_permissions/i.test(message);
}

/**
 * Grants that make sense for this church — a member cannot be given access to
 * something the account itself has switched off.
 */
async function sanitizeGrants(
  churchId: string,
  requested: FeatureKey[],
): Promise<FeatureKey[]> {
  const flags = await getChurchFeatureFlags(churchId, createAdminClient());
  return requested.filter((key) => flags[key]);
}

async function countChurchAdmins(churchId: string): Promise<number> {
  const admin = createAdminClient();
  const { count } = await admin
    .from("church_users")
    .select("id", { count: "exact", head: true })
    .eq("church_id", churchId)
    .eq("role", "admin");
  return count ?? 0;
}

/**
 * Platform-admin edit of one church member's role and feature access.
 *
 * The church's own Settings → Team does the same job for church admins; this is
 * the support path for when we are fixing an account on their behalf, so it
 * keeps the same guardrail — a church must never be left without an admin.
 */
export async function updateChurchUserAccess(
  _prev: AdminUserActionState,
  formData: FormData,
): Promise<AdminUserActionState> {
  await requireSuperAdmin();

  const memberId = formData.get("member_id")?.toString().trim() ?? "";
  if (!memberId) return { ok: false, error: "Missing user." };

  const role = formData.get("role")?.toString() === "admin" ? "admin" : "viewer";

  // FeatureAccessPicker carries the selection as repeated hidden "features"
  // inputs, matching Settings → Team.
  const requested = formData
    .getAll("features")
    .map((value) => value.toString())
    .filter(isFeatureKey);

  const admin = createAdminClient();

  const { data: member, error: loadError } = await admin
    .from("church_users")
    .select("id, user_id, church_id, role")
    .eq("id", memberId)
    .maybeSingle();

  if (loadError) return { ok: false, error: loadError.message };
  if (!member) return { ok: false, error: "User not found." };

  const churchId = member.church_id as string;

  // Admins hold everything implicitly, so their grant list stays empty.
  const grants = role === "admin" ? [] : await sanitizeGrants(churchId, requested);

  if (role === "viewer" && grants.length === 0) {
    return {
      ok: false,
      error: "Give this user access to at least one feature, or make them an admin.",
    };
  }

  if (member.role === "admin" && role !== "admin") {
    if ((await countChurchAdmins(churchId)) <= 1) {
      return { ok: false, error: "This church needs at least one admin." };
    }
  }

  let { error } = await admin
    .from("church_users")
    .update({ role, feature_permissions: grants })
    .eq("id", memberId);

  // Pre-0041 databases keep grants in app_metadata instead.
  if (error && isMissingFeaturePermissionsColumn(error.message)) {
    ({ error } = await admin
      .from("church_users")
      .update({ role })
      .eq("id", memberId));

    if (!error) {
      const stored = await writeGrantsToAppMetadata(
        member.user_id as string,
        grants,
      );
      if (!stored) {
        return {
          ok: false,
          error:
            "Could not save this user's feature access. Check that the service role key is configured.",
        };
      }
    }
  }

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/users");
  revalidatePath(`/admin/churches/${churchId}`);
  revalidatePath("/dashboard", "layout");

  return { ok: true, message: "Access updated." };
}

/** Removes a user's link to their church. The account itself is left alone. */
export async function removeChurchUser(
  _prev: AdminUserActionState,
  formData: FormData,
): Promise<AdminUserActionState> {
  await requireSuperAdmin();

  const memberId = formData.get("member_id")?.toString().trim() ?? "";
  if (!memberId) return { ok: false, error: "Missing user." };

  const admin = createAdminClient();
  const { data: member } = await admin
    .from("church_users")
    .select("id, church_id, role")
    .eq("id", memberId)
    .maybeSingle();

  if (!member) return { ok: false, error: "User not found." };

  const churchId = member.church_id as string;
  if (member.role === "admin" && (await countChurchAdmins(churchId)) <= 1) {
    return { ok: false, error: "This church needs at least one admin." };
  }

  const { error } = await admin
    .from("church_users")
    .delete()
    .eq("id", memberId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/users");
  revalidatePath(`/admin/churches/${churchId}`);

  return { ok: true, message: "User removed from the church." };
}
