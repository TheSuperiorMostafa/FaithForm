import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import { fetchInviteByToken, assertInviteEmail } from "@/lib/onboarding/validate-invite";
import { redirectToSettings } from "@/lib/integrations/app-redirect";
import { getGoogleAuthUrl } from "@/lib/integrations/google-oauth";
import { signOAuthState } from "@/lib/integrations/oauth-state";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const inviteToken = searchParams.get("token");
  const returnTo = searchParams.get("return_to") ?? undefined;

  let churchId: string;
  let userId: string;

  if (inviteToken) {
    const inviteResult = await fetchInviteByToken(inviteToken);
    if (!inviteResult.ok) {
      return NextResponse.json({ error: inviteResult.message }, { status: 403 });
    }

    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Sign in required" }, { status: 401 });
    }

    const emailCheck = assertInviteEmail(inviteResult.invite, user.email);
    if (!emailCheck.ok) {
      return NextResponse.json({ error: emailCheck.message }, { status: 403 });
    }

    churchId = inviteResult.invite.churchId;
    userId = user.id;
  } else {
    const auth = await getChurchAuth();
    if (!auth?.isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }
    churchId = auth.churchId;
    userId = auth.userId;
  }

  try {
    const state = signOAuthState({
      churchId,
      userId,
      provider: "google",
      returnTo,
    });
    const url = getGoogleAuthUrl(state);
    return NextResponse.redirect(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Google OAuth failed";
    return redirectToSettings({ integration_error: message }, returnTo);
  }
}
