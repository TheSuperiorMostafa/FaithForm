import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import { redirectToSettings } from "@/lib/integrations/app-redirect";
import { signOAuthState } from "@/lib/integrations/oauth-state";
import { getYouTubeAuthUrl } from "@/lib/integrations/youtube-live";

export async function GET(request: Request) {
  const auth = await getChurchAuth();
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Admin access required" }, { status: 403 });
  }

  const { searchParams } = new URL(request.url);
  const returnTo =
    searchParams.get("return_to") ?? "/dashboard/live-streaming";

  try {
    const state = signOAuthState({
      churchId: auth.churchId,
      userId: auth.userId,
      provider: "youtube",
      returnTo,
    });
    const url = getYouTubeAuthUrl(state);
    return NextResponse.redirect(url);
  } catch (err) {
    const message = err instanceof Error ? err.message : "YouTube OAuth failed";
    return redirectToSettings({ integration_error: message }, returnTo);
  }
}
