"use server";

import { revalidatePath } from "next/cache";
import { requireSuperAdmin } from "@/lib/auth/superadmin";
import { sendInviteEmail } from "@/lib/email/invite";
import type {
  FacebookIntegrationMetadata,
  GoogleIntegrationMetadata,
} from "@/lib/integrations/types";
import {
  assertInviteEmail,
  fetchInviteByChurchId,
  fetchInviteByToken,
  inviteNeedsRefresh,
  type InviteValidationResult,
  type ValidInvite,
} from "@/lib/onboarding/validate-invite";
import { requireOnboardingInvitee } from "@/lib/onboarding/require-invitee";
import { prepareChurchLogo } from "@/lib/branding/church-logo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toUserError } from "@/lib/errors/user-error";
import {
  ALREADY_REGISTERED_MESSAGE,
  isAlreadyRegistered,
  signUpErrorMessage,
} from "@/app/login/auth-messages";

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

export type CreateAccountResult =
  | { ok: true }
  | { ok: false; error: string };

export type ResendInviteResult =
  | { ok: true; email: string; delivery: "sent" | "unconfirmed" | "old_links_active" }
  | { ok: false; error: string };

export type IntegrationStatusResult = {
  google: {
    connected: boolean;
    email: string | null;
  };
  facebook: {
    connected: boolean;
    pageName: string | null;
  };
};

export async function validateInviteToken(
  token: string,
): Promise<InviteValidationResult> {
  return fetchInviteByToken(token);
}

export async function createOnboardingAccount(
  token: string,
  data: {
    firstName: string;
    lastName: string;
    email: string;
    password: string;
  },
): Promise<CreateAccountResult> {
  const inviteResult = await fetchInviteByToken(token);
  if (!inviteResult.ok) {
    return { ok: false, error: inviteResult.message };
  }

  if (data.email.toLowerCase() !== inviteResult.invite.email.toLowerCase()) {
    return { ok: false, error: "Email must match the invite." };
  }

  if (data.password.length < 8) {
    return { ok: false, error: "Password must be at least 8 characters." };
  }

  const supabase = createClient();
  // The validated invite link was delivered to this exact mailbox. That
  // first email proves address ownership, so create the confirmed account
  // on the trusted server instead of sending a second confirmation email.
  // Public sign-up confirmation remains enabled.
  const admin = createAdminClient();
  const { error: createError } = await admin.auth.admin.createUser({
    email: data.email,
    password: data.password,
    email_confirm: true,
    user_metadata: {
      first_name: data.firstName,
      last_name: data.lastName,
    },
  });

  if (createError) {
    if (isAlreadyRegistered(createError)) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      if (signInError) {
        return { ok: false, error: ALREADY_REGISTERED_MESSAGE };
      }
      return { ok: true };
    }
    console.error("[onboarding] account creation refused:", createError.name);
    return { ok: false, error: signUpErrorMessage(createError, 8) };
  }

  const { error: signInError } = await supabase.auth.signInWithPassword({
    email: data.email,
    password: data.password,
  });
  if (signInError) {
    return { ok: false, error: "Your account was created, but sign-in did not finish. Try continuing with the same password." };
  }

  return { ok: true };
}

export async function updateChurchProfile(
  churchId: string,
  token: string,
  data: {
    name: string;
    address?: string;
    city?: string;
    state?: string;
    zip?: string;
    website?: string;
    phone?: string;
    logoUrl?: string;
    skipOptional?: boolean;
  },
): Promise<ActionResult> {
  const auth = await requireOnboardingInvitee(token, churchId);
  if (!auth.ok) {
    return { ok: false, error: auth.error };
  }

  if (!data.name.trim()) {
    return { ok: false, error: "Please enter your church's name." };
  }

  const admin = createAdminClient();
  const update: Record<string, string | null> = {
    name: data.name.trim(),
  };

  if (!data.skipOptional) {
    update.address = data.address?.trim() || null;
    update.city = data.city?.trim() || null;
    update.state = data.state?.trim() || null;
    update.zip = data.zip?.trim() || null;
    update.website = data.website?.trim() || null;
    update.phone = data.phone?.trim() || null;
    if (data.logoUrl) update.logo_url = data.logoUrl;
  }

  const { data: updated, error } = await admin
    .from("churches")
    .update(update)
    .eq("id", churchId)
    .is("onboarding_completed_at", null)
    .select("id")
    .maybeSingle();

  if (error) {
    return { ok: false, error: toUserError(error, "We couldn't save your church's details.") };
  }
  if (!updated) {
    return { ok: false, error: "This church has already completed setup. Sign in to change its details." };
  }

  return { ok: true };
}

export async function uploadChurchLogo(
  churchId: string,
  token: string,
  formData: FormData,
): Promise<{ ok: true; logoUrl: string } | { ok: false; error: string }> {
  const auth = await requireOnboardingInvitee(token, churchId);
  if (!auth.ok) {
    return { ok: false, error: auth.error };
  }

  const file = formData.get("logo") as File | null;
  if (!file || file.size === 0) {
    return { ok: false, error: "No file provided." };
  }

  const prepared = await prepareChurchLogo(file, formData.get("crop"));
  if (!prepared.ok) {
    return { ok: false, error: prepared.error };
  }
  const validated = prepared.image;

  const path = `${churchId}/logo.${validated.ext}`;

  const admin = createAdminClient();
  const { error: uploadError } = await admin.storage
    .from("church-logos")
    .upload(path, validated.buffer, {
      contentType: validated.contentType,
      upsert: true,
    });

  if (uploadError) {
    return { ok: false, error: toUserError(uploadError, "We couldn't upload your logo.") };
  }

  const { data: publicUrl } = admin.storage
    .from("church-logos")
    .getPublicUrl(path);

  // The path is reused on every upload, so the URL carries a version: without
  // it a re-framed logo keeps showing the old crop from every browser cache.
  const logoUrl = `${publicUrl.publicUrl}?v=${Date.now()}`;
  const { data: updated, error: profileError } = await admin
    .from("churches")
    .update({ logo_url: logoUrl })
    .eq("id", churchId)
    .is("onboarding_completed_at", null)
    .select("id")
    .maybeSingle();

  if (profileError) {
    return { ok: false, error: toUserError(profileError, "We couldn't save your logo to the church profile.") };
  }
  if (!updated) {
    return { ok: false, error: "This church has already completed setup. Sign in to change its logo." };
  }

  return { ok: true, logoUrl };
}

export async function getOnboardingIntegrationStatus(
  churchId: string,
  token: string,
): Promise<IntegrationStatusResult | { ok: false; error: string }> {
  const auth = await requireOnboardingInvitee(token, churchId);
  if (!auth.ok) {
    return { ok: false, error: auth.error };
  }

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("church_integrations")
    .select("provider, access_token, metadata")
    .eq("church_id", churchId);

  if (error) {
    return { ok: false, error: "We couldn't check connected accounts. Please reload this step and try again." };
  }

  const rows = data ?? [];
  const google = rows.find((r) => r.provider === "google");
  const facebook = rows.find((r) => r.provider === "facebook");
  const googleMeta = (google?.metadata ?? {}) as GoogleIntegrationMetadata;
  const facebookMeta = (facebook?.metadata ?? {}) as FacebookIntegrationMetadata;

  return {
    google: {
      connected: Boolean(google?.access_token),
      email: googleMeta.email ?? null,
    },
    facebook: {
      connected: Boolean(facebook?.access_token),
      pageName: facebookMeta.page_name ?? null,
    },
  };
}

export async function completeOnboarding(token: string): Promise<ActionResult> {
  const inviteResult = await fetchInviteByToken(token);
  if (!inviteResult.ok) {
    return { ok: false, error: inviteResult.message };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to complete setup." };
  }

  const emailCheck = assertInviteEmail(inviteResult.invite, user.email);
  if (!emailCheck.ok) {
    return { ok: false, error: emailCheck.message };
  }

  const admin = createAdminClient();
  // The function rechecks the invite under a row lock and commits the admin
  // membership, church completion, and invite acceptance together.
  const { data: outcome, error } = await admin.rpc("complete_church_onboarding", {
    p_token: token.trim(),
    p_user_id: user.id,
    p_user_email: user.email ?? "",
  });
  if (error) return { ok: false, error: toUserError(error, "We couldn't finish setup. Please try again.") };
  if (outcome === "completed") return { ok: true };
  if (outcome === "expired") return { ok: false, error: "This invite has expired. Contact your administrator." };
  if (outcome === "email_mismatch") return { ok: false, error: "Sign in with the email address that received this invite." };
  if (outcome === "already_accepted" || outcome === "already_complete") {
    return { ok: false, error: "Setup is already complete. Sign in to continue." };
  }
  return { ok: false, error: "This invite link is invalid." };
}

export async function resendInvite(
  churchId: string,
): Promise<ResendInviteResult> {
  await requireSuperAdmin();

  const admin = createAdminClient();
  const { data: church, error: churchError } = await admin
    .from("churches")
    .select("id, name, onboarding_completed_at")
    .eq("id", churchId)
    .maybeSingle();

  if (churchError || !church) {
    return { ok: false, error: "Church not found." };
  }

  if (church.onboarding_completed_at) {
    return { ok: false, error: "This church has already completed onboarding." };
  }

  const existingInvite = await fetchInviteByChurchId(churchId);
  if (!existingInvite) {
    return { ok: false, error: "No pending invite found. Create a new invite from Add Church." };
  }

  const email = existingInvite.email;
  const adminFirstName = existingInvite.adminFirstName;
  let inviteId = existingInvite.id;
  let token = existingInvite.token;
  if (inviteNeedsRefresh(existingInvite.expiresAt)) {
    // Only an expired link needs replacing. Keep the old row until a new one
    // exists, so a failed insert cannot strand the church. A failed email can
    // then be retried using the newly created, still-valid link.
    const { data: newInvite, error: newError } = await admin
      .from("church_invites")
      .insert({
        church_id: churchId,
        email,
        admin_first_name: adminFirstName,
        admin_last_name: existingInvite.adminLastName,
      })
      .select("id, token")
      .single();

    if (newError || !newInvite) {
      return { ok: false, error: newError?.message ?? "Could not create invite." };
    }
    inviteId = newInvite.id;
    token = newInvite.token;
  }

  try {
    await sendInviteEmail({
      email,
      churchName: church.name,
      token,
      adminFirstName,
    });
  } catch (err) {
    console.error("[onboarding] invitation resend delivery was not confirmed:", err instanceof Error ? err.name : "UnknownError");
    revalidatePath("/admin/churches");
    revalidatePath(`/admin/churches/${churchId}`);
    return { ok: true, email, delivery: "unconfirmed" };
  }

  const { error: oldInviteError } = await admin
    .from("church_invites")
    .delete()
    .eq("church_id", churchId)
    .is("accepted_at", null)
    .neq("id", inviteId);
  if (oldInviteError) {
    console.error("[onboarding] old invitations could not be disabled:", oldInviteError.message);
    revalidatePath("/admin/churches");
    revalidatePath(`/admin/churches/${churchId}`);
    return { ok: true, email, delivery: "old_links_active" };
  }

  revalidatePath("/admin/churches");
  revalidatePath(`/admin/churches/${churchId}`);
  return { ok: true, email, delivery: "sent" };
}

export type { ValidInvite, InviteValidationResult };
