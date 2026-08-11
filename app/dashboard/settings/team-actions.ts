"use server";

import { revalidatePath } from "next/cache";

import { findAuthUserByEmail } from "@/lib/auth/auth-users";
import { getChurchAuth } from "@/lib/auth/church";
import {
  generateTempPassword,
  MUST_CHANGE_PASSWORD_KEY,
} from "@/lib/auth/temp-password";
import { sendTeamInviteEmail } from "@/lib/email/team-invite";
import { getChurchFeatureFlags } from "@/lib/features/access";
import { getFeature, isFeatureKey, type FeatureKey } from "@/lib/features/catalog";
import { countChurchAdmins, toTeamRole, type TeamRole } from "@/lib/queries/team";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";

export type TeamFormState = {
  ok: boolean;
  error?: string;
  message?: string;
  /**
   * Shown once, right after it is minted. Nothing stores it — Supabase keeps
   * only the hash — so the admin either passes it on now or issues a new one.
   */
  tempPassword?: string;
  /** Who the temp password belongs to, so the dialog can label it. */
  tempPasswordEmail?: string;
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type AdminContext = {
  churchId: string;
  userId: string;
};

async function requireChurchAdminContext(): Promise<
  { ok: true; ctx: AdminContext } | { ok: false; error: string }
> {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);

  if (!auth) return { ok: false, error: "Not signed in." };
  if (!auth.isAdmin) {
    return { ok: false, error: "Only church admins can manage team members." };
  }

  return { ok: true, ctx: { churchId: auth.churchId, userId: auth.userId } };
}

/**
 * Grants are intersected with what the account actually has enabled, so a
 * church admin can never hand out a feature the platform has switched off.
 */
async function sanitizeFeatureGrants(
  churchId: string,
  requested: string[],
): Promise<FeatureKey[]> {
  const flags = await getChurchFeatureFlags(churchId, createAdminClient());
  return requested
    .filter(isFeatureKey)
    .filter((key) => flags[key])
    .filter((key, index, all) => all.indexOf(key) === index);
}

function readFeatureGrants(formData: FormData): string[] {
  return formData.getAll("features").map((value) => value.toString());
}

function readRole(formData: FormData): TeamRole | null {
  const raw = formData.get("role")?.toString() ?? "";
  if (raw !== "admin" && raw !== "viewer") return null;
  return raw;
}

export async function inviteTeamMember(
  _prev: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const guard = await requireChurchAdminContext();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { churchId, userId } = guard.ctx;

  const email = formData.get("email")?.toString().trim().toLowerCase() ?? "";
  if (!EMAIL_RE.test(email)) {
    return { ok: false, error: "Enter a valid email address." };
  }

  const role = readRole(formData);
  if (!role) return { ok: false, error: "Choose a role for this teammate." };

  const grants =
    role === "admin"
      ? []
      : await sanitizeFeatureGrants(churchId, readFeatureGrants(formData));

  if (role === "viewer" && grants.length === 0) {
    return {
      ok: false,
      error: "Give this member access to at least one feature.",
    };
  }

  const admin = createAdminClient();

  let authUser: { id: string; email: string | null } | null = null;
  try {
    authUser = await findAuthUserByEmail(email);
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not look up that email.",
    };
  }

  // A brand-new account gets a temporary password the admin can hand over on
  // the spot; the set-password screen makes them replace it the first time
  // they sign in. Someone who already has a FaithForm login keeps theirs.
  let tempPassword: string | null = null;

  if (!authUser) {
    tempPassword = generateTempPassword();

    const { data, error } = await admin.auth.admin.createUser({
      email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { [MUST_CHANGE_PASSWORD_KEY]: true },
    });

    if (error || !data.user) {
      return {
        ok: false,
        error: error?.message ?? "Could not create an account for that email.",
      };
    }

    authUser = { id: data.user.id, email: data.user.email ?? email };
  }

  // A user belongs to exactly one church — the dashboard resolves a single
  // church link per session, so a second membership would silently shadow one.
  const { data: existingLinks, error: linkError } = await admin
    .from("church_users")
    .select("id, church_id")
    .eq("user_id", authUser.id);

  if (linkError) return { ok: false, error: linkError.message };

  const linkedHere = existingLinks?.find((row) => row.church_id === churchId);
  if (linkedHere) {
    return { ok: false, error: "That person is already on your team." };
  }
  if ((existingLinks?.length ?? 0) > 0) {
    return {
      ok: false,
      error: "That email already belongs to another church on FaithForm.",
    };
  }

  const insertRow = {
    church_id: churchId,
    user_id: authUser.id,
    role,
    feature_permissions: grants,
    invited_by: userId,
    invited_at: new Date().toISOString(),
  };

  let { error: insertError } = await admin
    .from("church_users")
    .insert(insertRow);

  // Tolerate a database that has not had migration 0041 applied yet.
  if (
    insertError &&
    /feature_permissions|invited_by|invited_at/i.test(insertError.message)
  ) {
    ({ error: insertError } = await admin.from("church_users").insert({
      church_id: churchId,
      user_id: authUser.id,
      role,
    }));
  }

  if (insertError) return { ok: false, error: insertError.message };

  const { data: church } = await admin
    .from("churches")
    .select("name")
    .eq("id", churchId)
    .maybeSingle();

  let emailNote = "";
  try {
    const result = await sendTeamInviteEmail({
      email,
      churchName: (church?.name as string | undefined)?.trim() || "your church",
      featureLabels: grants.map((key) => getFeature(key).label),
      isAdmin: role === "admin",
      tempPassword,
    });
    if (!result.sent) {
      emailNote = tempPassword
        ? " Email delivery is not configured, so pass the temporary password on yourself."
        : " Email delivery is not configured, so let them know they can sign in at the login page.";
    }
  } catch (err) {
    // The membership is already live; a failed email must not roll that back.
    emailNote = ` The invite email could not be sent (${
      err instanceof Error ? err.message : "unknown error"
    }). ${
      tempPassword
        ? "Pass the temporary password on yourself."
        : "They can still sign in from the login page."
    }`;
  }

  revalidatePath("/dashboard/settings");

  return {
    ok: true,
    message: tempPassword
      ? `${email} was added to your team.${emailNote}`
      : `${email} was added to your team — they sign in with the FaithForm password they already have.${emailNote}`,
    tempPassword: tempPassword ?? undefined,
    tempPasswordEmail: tempPassword ? email : undefined,
  };
}

/**
 * Issues a fresh temporary password for a teammate who cannot get in.
 *
 * The old one stops working immediately and the set-password screen comes back
 * on their next sign-in, so a password read out over the phone never survives
 * past the first use.
 */
export async function resetTeamMemberPassword(
  _prev: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const guard = await requireChurchAdminContext();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { churchId } = guard.ctx;

  const memberId = formData.get("member_id")?.toString().trim() ?? "";
  if (!memberId) return { ok: false, error: "Missing team member." };

  const admin = createAdminClient();

  const { data: member, error: loadError } = await admin
    .from("church_users")
    .select("id, user_id")
    .eq("id", memberId)
    .eq("church_id", churchId)
    .maybeSingle();

  if (loadError) return { ok: false, error: loadError.message };
  if (!member) return { ok: false, error: "Team member not found." };

  const { data: existing } = await admin.auth.admin.getUserById(
    member.user_id as string,
  );

  const tempPassword = generateTempPassword();
  const { error } = await admin.auth.admin.updateUserById(
    member.user_id as string,
    {
      password: tempPassword,
      user_metadata: {
        ...(existing?.user?.user_metadata ?? {}),
        [MUST_CHANGE_PASSWORD_KEY]: true,
      },
    },
  );

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/settings");

  return {
    ok: true,
    message: "New temporary password ready.",
    tempPassword,
    tempPasswordEmail: existing?.user?.email ?? undefined,
  };
}

export async function updateTeamMemberAccess(
  _prev: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const guard = await requireChurchAdminContext();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { churchId, userId } = guard.ctx;

  const memberId = formData.get("member_id")?.toString().trim() ?? "";
  if (!memberId) return { ok: false, error: "Missing team member." };

  const role = readRole(formData);
  if (!role) return { ok: false, error: "Choose a role for this teammate." };

  const grants =
    role === "admin"
      ? []
      : await sanitizeFeatureGrants(churchId, readFeatureGrants(formData));

  if (role === "viewer" && grants.length === 0) {
    return {
      ok: false,
      error: "Give this member access to at least one feature.",
    };
  }

  const admin = createAdminClient();

  const { data: member, error: loadError } = await admin
    .from("church_users")
    .select("id, user_id, role")
    .eq("id", memberId)
    .eq("church_id", churchId)
    .maybeSingle();

  if (loadError) return { ok: false, error: loadError.message };
  if (!member) return { ok: false, error: "Team member not found." };

  const demotingAnAdmin = member.role === "admin" && role !== "admin";

  if (demotingAnAdmin) {
    if (member.user_id === userId) {
      return {
        ok: false,
        error: "You cannot remove your own admin access.",
      };
    }
    if ((await countChurchAdmins(churchId)) <= 1) {
      return {
        ok: false,
        error: "Your church needs at least one admin.",
      };
    }
  }

  const updateRow = { role, feature_permissions: grants };

  let { error } = await admin
    .from("church_users")
    .update(updateRow)
    .eq("id", memberId)
    .eq("church_id", churchId);

  if (error && /feature_permissions/i.test(error.message)) {
    ({ error } = await admin
      .from("church_users")
      .update({ role })
      .eq("id", memberId)
      .eq("church_id", churchId));
  }

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/settings");
  revalidatePath("/dashboard");

  return { ok: true, message: "Access updated." };
}

export async function removeTeamMember(
  _prev: TeamFormState,
  formData: FormData,
): Promise<TeamFormState> {
  const guard = await requireChurchAdminContext();
  if (!guard.ok) return { ok: false, error: guard.error };
  const { churchId, userId } = guard.ctx;

  const memberId = formData.get("member_id")?.toString().trim() ?? "";
  if (!memberId) return { ok: false, error: "Missing team member." };

  const admin = createAdminClient();

  const { data: member, error: loadError } = await admin
    .from("church_users")
    .select("id, user_id, role")
    .eq("id", memberId)
    .eq("church_id", churchId)
    .maybeSingle();

  if (loadError) return { ok: false, error: loadError.message };
  if (!member) return { ok: false, error: "Team member not found." };

  if (member.user_id === userId) {
    return { ok: false, error: "You cannot remove yourself from the team." };
  }

  if (
    toTeamRole(member.role) === "admin" &&
    (await countChurchAdmins(churchId)) <= 1
  ) {
    return { ok: false, error: "Your church needs at least one admin." };
  }

  // Removes the church membership only. The person keeps their FaithForm
  // login, so re-adding them later is a single click.
  const { error } = await admin
    .from("church_users")
    .delete()
    .eq("id", memberId)
    .eq("church_id", churchId);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard/settings");

  return { ok: true, message: "Team member removed." };
}
