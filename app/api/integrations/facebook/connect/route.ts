import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import { denyUnlessAnyFeature } from "@/lib/features/guard";
import { fetchInviteByToken, assertInviteEmail } from "@/lib/onboarding/validate-invite";
import { redirectToSettings } from "@/lib/integrations/app-redirect";
import { getFacebookAuthUrl } from "@/lib/integrations/facebook";
import { signOAuthState } from "@/lib/integrations/oauth-state";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const inviteToken = searchParams.get("token");
  const returnTo = searchParams.get("return_to") ?? undefined;

  let churchId: string;
  let userId: string;
  let via: "admin" | "invite";

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
    via = "invite";
  } else {
    const auth = await getChurchAuth();
    if (!auth?.isAdmin) {
      return NextResponse.json({ error: "Admin access required" }, { status: 403 });
    }

    // Facebook serves two features — page posts for Announcements and Live
    // broadcasts — so either one is enough to justify the connection. The
    // invite branch above is deliberately exempt: onboarding runs before a
    // church has anything to gate on.
    const denied = await denyUnlessAnyFeature(["announcements", "live_stream"]);
    if (denied) return denied;

    churchId = auth.churchId;
    userId = auth.userId;
    via = "admin";
  }

  try {
    const state = signOAuthState({
      churchId,
      userId,
      provider: "facebook",
      returnTo,
      via,
    });
    const url = getFacebookAuthUrl(state);
    return NextResponse.redirect(url);
  } catch (err) {
    const code = err instanceof Error && err.message === "Facebook OAuth is not configured"
      ? "facebook_setup_missing"
      : "facebook_connect_failed";
    console.error("Facebook connection: could not start", { code });
    return redirectToSettings({ integration_error: code }, returnTo);
  }
}
