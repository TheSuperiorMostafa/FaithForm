import { exchangeFacebookCode } from "@/lib/integrations/facebook";
import {
  redirectToApp,
  redirectToSettings,
} from "@/lib/integrations/app-redirect";
import { assertOAuthSessionUser } from "@/lib/integrations/assert-oauth-session";
import { verifyOAuthState } from "@/lib/integrations/oauth-state";
import { createClient } from "@/lib/supabase/server";

const FACEBOOK_PAGE_SCOPES = new Set([
  "pages_show_list",
  "pages_manage_posts",
  "pages_read_engagement",
  "business_management",
]);

/** Keep third-party callback values out of logs unless they are known scopes. */
function grantedFacebookPageScopes(value: string | null): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((scope) => scope.trim())
    .filter((scope) => FACEBOOK_PAGE_SCOPES.has(scope));
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");
  const grantedScopes = grantedFacebookPageScopes(searchParams.get("granted_scopes"));

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

  const sessionMismatch = await assertOAuthSessionUser(payload, returnTo);
  if (sessionMismatch) return sessionMismatch;

  try {
    const supabase = createClient();
    await exchangeFacebookCode(
      code,
      payload.churchId,
      payload.userId,
      supabase,
      { provisionLive: false, grantedScopes },
    );
    if (returnTo) {
      const url = new URL(returnTo, "http://localhost");
      url.searchParams.set("facebook_connected", "1");
      return redirectToApp(`${url.pathname}${url.search}`);
    }
    return redirectToApp("/dashboard/settings?facebook_connected=1");
  } catch (err) {
    const reason = err instanceof Error ? err.message : "facebook_connect_failed";
    const known = new Set([
      "facebook_token_exchange_failed",
      "facebook_pages_unavailable",
      "facebook_no_pages",
      "facebook_save_failed",
    ]);
    const code = known.has(reason) ? reason : "facebook_connect_failed";
    if (code === "facebook_connect_failed") {
      console.error("Facebook connection: unexpected callback failure", err);
    }
    return redirectToSettings({ integration_error: code }, returnTo);
  }
}
