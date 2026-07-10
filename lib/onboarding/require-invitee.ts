import type { InviteValidationResult, ValidInvite } from "@/lib/onboarding/validate-invite";
import {
  assertInviteEmail,
  fetchInviteByToken,
} from "@/lib/onboarding/validate-invite";
import { createClient } from "@/lib/supabase/server";

export type OnboardingAuthResult =
  | { ok: false; error: string }
  | { ok: true; invite: ValidInvite; userId: string };

export async function requireOnboardingInvitee(
  token: string,
  churchId: string,
): Promise<OnboardingAuthResult> {
  const inviteResult = await fetchInviteByToken(token);
  if (!inviteResult.ok) {
    return { ok: false, error: inviteResult.message };
  }
  if (inviteResult.invite.churchId !== churchId) {
    return { ok: false, error: "Invalid church for this invite." };
  }

  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return { ok: false, error: "You must be signed in to continue setup." };
  }

  const emailCheck = assertInviteEmail(inviteResult.invite, user.email);
  if (!emailCheck.ok) {
    return { ok: false, error: emailCheck.message };
  }

  return { ok: true, invite: inviteResult.invite, userId: user.id };
}

export type { InviteValidationResult };
