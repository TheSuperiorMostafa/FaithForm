import { exchangeFacebookCode } from "@/lib/integrations/facebook";
import {
  redirectToApp,
  redirectToSettings,
} from "@/lib/integrations/app-redirect";
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

  if (!payload || payload.provider !== "facebook") {
    return redirectToSettings({ integration_error: "invalid_state" }, returnTo);
  }

  try {
    const supabase = createClient();
    await exchangeFacebookCode(
      code,
      payload.churchId,
      payload.userId,
      supabase,
    );
    if (returnTo) {
      const url = new URL(returnTo, "http://localhost");
      url.searchParams.set("facebook_connected", "1");
      return redirectToApp(`${url.pathname}${url.search}`);
    }
    return redirectToApp("/dashboard/settings?facebook_connected=1");
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Facebook connect failed";
    return redirectToSettings({ integration_error: message }, returnTo);
  }
}
