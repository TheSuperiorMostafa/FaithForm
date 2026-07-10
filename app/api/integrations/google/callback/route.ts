import { exchangeGoogleCode } from "@/lib/integrations/google-oauth";
import { exchangeYouTubeCode } from "@/lib/integrations/youtube-live";
import {
  redirectToApp,
  redirectToSettings,
} from "@/lib/integrations/app-redirect";
import { assertOAuthSessionUser } from "@/lib/integrations/assert-oauth-session";
import { verifyOAuthState } from "@/lib/integrations/oauth-state";
import { createClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  const payload = state ? verifyOAuthState(state) : null;
  const returnTo = payload?.returnTo;

  if (error) {
    return redirectToSettings({ integration_error: error }, returnTo);
  }

  if (!code || !state) {
    return redirectToSettings({ integration_error: "missing_code" }, returnTo);
  }

  if (
    !payload ||
    (payload.provider !== "google" && payload.provider !== "youtube")
  ) {
    return redirectToSettings({ integration_error: "invalid_state" }, returnTo);
  }

  const sessionMismatch = await assertOAuthSessionUser(payload.userId, returnTo);
  if (sessionMismatch) return sessionMismatch;

  try {
    const supabase = createClient();
    if (payload.provider === "youtube") {
      await exchangeYouTubeCode(
        code,
        payload.churchId,
        payload.userId,
        supabase,
      );
      const url = new URL(returnTo ?? "/dashboard/live-streaming", "http://localhost");
      url.searchParams.set("youtube_connected", "1");
      return redirectToApp(`${url.pathname}${url.search}`);
    }

    await exchangeGoogleCode(
      code,
      payload.churchId,
      payload.userId,
      supabase,
    );
    if (returnTo) {
      const url = new URL(returnTo, "http://localhost");
      url.searchParams.set("google_connected", "1");
      return redirectToApp(`${url.pathname}${url.search}`);
    }
    return redirectToApp("/dashboard/settings?google_connected=1");
  } catch (err) {
    const message = err instanceof Error ? err.message : "Google connect failed";
    return redirectToSettings({ integration_error: message }, returnTo);
  }
}
