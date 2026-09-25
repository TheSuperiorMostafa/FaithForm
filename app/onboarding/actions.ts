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
  type InviteValidationResult,
  type ValidInvite,
} from "@/lib/onboarding/validate-invite";
import { requireOnboardingInvitee } from "@/lib/onboarding/require-invitee";
import { prepareChurchLogo } from "@/lib/branding/church-logo";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { dashboardEmailRedirect } from "@/lib/auth/auth-redirects";
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
  | { ok: true; needsEmailConfirmation: boolean }
  | { ok: false; error: string };

export type ResendInviteResult =
  | { ok: true; email: string }
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
  // The confirmation link must resume after account creation. `next` is a
  // relative path because the callback validates it with `safeRedirectPath`.
  const emailRedirectTo = dashboardEmailRedirect(
    `/onboarding?token=${encodeURIComponent(token)}&step=3`,
  );

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: {
      data: {
        first_name: data.firstName,
        last_name: data.lastName,
      },
      emailRedirectTo,
    },
  });

  if (signUpError) {
    if (isAlreadyRegistered(signUpError)) {
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: data.email,
        password: data.password,
      });
      if (signInError) {
        return { ok: false, error: ALREADY_REGISTERED_MESSAGE };
      }
      return { ok: true, needsEmailConfirmation: false };
    }
    console.error("[onboarding] sign-up refused:", signUpError.message);
    return { ok: false, error: signUpErrorMessage(signUpError, 8) };
  }

  return { ok: true, needsEmailConfirmation: !signUpData.session };
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

  const { error } = await admin
    .from("churches")
    .update(update)
    .eq("id", churchId);

  if (error) {
    return { ok: false, error: toUserError(error, "We couldn't save your church's details.") };
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
  await admin
    .from("churches")
    .update({ logo_url: logoUrl })
    .eq("id", churchId);

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
  const { data } = await admin
    .from("church_integrations")
    .select("provider, access_token, metadata")
    .eq("church_id", churchId);

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
  const now = new Date().toISOString();

  await admin
    .from("church_invites")
    .update({ accepted_at: now })
    .eq("id", inviteResult.invite.id);

  await admin
    .from("churches")
    .update({ onboarding_completed_at: now })
    .eq("id", inviteResult.invite.churchId);

  const { error: linkError } = await admin.from("church_users").upsert(
    {
      church_id: inviteResult.invite.churchId,
      user_id: user.id,
      role: "admin",
      onboarding_step: "completed",
    },
    { onConflict: "church_id,user_id" },
  );

  if (linkError) {
    return { ok: false, error: toUserError(linkError, "We couldn't finish setting up your account.") };
  }

  return { ok: true };
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

  let email: string;
  let adminFirstName: string;
  let adminLastName: string;
  let token: string;

  if (existingInvite) {
    email = existingInvite.email;
    adminFirstName = existingInvite.adminFirstName;
    adminLastName = existingInvite.adminLastName;

    await admin
      .from("church_invites")
      .delete()
      .eq("church_id", churchId)
      .is("accepted_at", null);

    const { data: newInvite, error: newError } = await admin
      .from("church_invites")
      .insert({
        church_id: churchId,
        email,
        admin_first_name: adminFirstName,
        admin_last_name: adminLastName,
      })
      .select("token")
      .single();

    if (newError || !newInvite) {
      return { ok: false, error: newError?.message ?? "Could not create invite." };
    }
    token = newInvite.token;
  } else {
    return {
      ok: false,
      error: "No pending invite found. Create a new invite from Add Church.",
    };
  }

  try {
    await sendInviteEmail({
      email,
      churchName: church.name,
      token,
      adminFirstName,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Failed to send email.",
    };
  }

  revalidatePath("/admin/churches");
  return { ok: true, email };
}

export type { ValidInvite, InviteValidationResult };
