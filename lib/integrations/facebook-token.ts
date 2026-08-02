import type { SupabaseClient } from "@supabase/supabase-js";
import {
  clearReconnectFlags,
  getIntegration,
  markIntegrationNeedsReconnect,
  saveIntegration,
} from "@/lib/integrations/tokens";
import type { FacebookIntegrationMetadata } from "@/lib/integrations/types";
import { absoluteAppPath } from "@/lib/site-url";

export const GRAPH = "https://graph.facebook.com/v21.0";

export type FacebookPage = { id: string; name: string; access_token: string };

export class FacebookReconnectRequiredError extends Error {
  constructor() {
    super("Facebook access expired. Reconnect Facebook in Settings.");
    this.name = "FacebookReconnectRequiredError";
  }
}

export function getFacebookConfig() {
  const appId = process.env.FACEBOOK_APP_ID;
  const appSecret = process.env.FACEBOOK_APP_SECRET;
  const redirectUri =
    process.env.FACEBOOK_REDIRECT_URI?.trim() ||
    absoluteAppPath("/api/integrations/facebook/callback");

  if (!appId || !appSecret) {
    throw new Error("Facebook OAuth is not configured");
  }

  return { appId, appSecret, redirectUri };
}

/**
 * Trades a short-lived user token for the ~60-day long-lived one.
 *
 * This step is what makes the connection durable. A Page token inherits the
 * lifetime of the user token it was derived from, so deriving Page tokens
 * straight from the code-exchange token produced credentials that died after
 * about an hour — the "Facebook keeps disconnecting" symptom. Page tokens
 * derived from a long-lived user token do not expire.
 */
export async function exchangeForLongLivedUserToken(
  shortLivedToken: string,
): Promise<{ token: string; expiresAt: Date | null }> {
  const { appId, appSecret } = getFacebookConfig();

  const res = await fetch(
    `${GRAPH}/oauth/access_token?${new URLSearchParams({
      grant_type: "fb_exchange_token",
      client_id: appId,
      client_secret: appSecret,
      fb_exchange_token: shortLivedToken,
    })}`,
  );

  const data = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: { message: string };
  };

  if (!res.ok || !data.access_token) {
    // Fall back to the short-lived token rather than failing the connect
    // outright — the admin still gets a working (if brief) session, and the
    // metadata records that it is not long-lived.
    return { token: shortLivedToken, expiresAt: null };
  }

  return {
    token: data.access_token,
    expiresAt: data.expires_in
      ? new Date(Date.now() + data.expires_in * 1000)
      : null,
  };
}

export async function fetchFacebookPages(
  userToken: string,
): Promise<FacebookPage[]> {
  const res = await fetch(
    `${GRAPH}/me/accounts?${new URLSearchParams({
      access_token: userToken,
      fields: "id,name,access_token",
    })}`,
  );

  const data = (await res.json().catch(() => ({}))) as {
    data?: FacebookPage[];
    error?: { message: string };
  };

  if (!res.ok) {
    throw new Error(data.error?.message ?? "Could not read Facebook Pages");
  }

  return data.data ?? [];
}

/** Facebook error codes that mean the token is dead rather than the call bad. */
export function isFacebookAuthError(error: {
  code?: number;
  type?: string;
  message?: string;
}): boolean {
  if (error.code === 190 || error.code === 102 || error.code === 463) {
    return true;
  }
  if (error.type === "OAuthException") return true;
  return /access token|session has expired|not authenticated/i.test(
    error.message ?? "",
  );
}

/**
 * Re-derives the Page token from the stored long-lived user token.
 *
 * Lets a Page token that was invalidated (password change, Page role edit, or
 * an old short-lived token issued before the long-lived exchange landed) heal
 * itself on the next call instead of forcing the admin through OAuth again.
 */
export async function refreshFacebookPageToken(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<string | null> {
  const integration = await getIntegration(churchId, "facebook", supabase);
  const userToken = integration?.refresh_token?.trim();
  if (!integration || !userToken) return null;

  const meta = (integration.metadata ?? {}) as FacebookIntegrationMetadata;
  if (!meta.page_id) return null;

  let pages: FacebookPage[];
  try {
    pages = await fetchFacebookPages(userToken);
  } catch {
    return null;
  }

  const page = pages.find((p) => p.id === meta.page_id);
  if (!page?.access_token) return null;

  await saveIntegration(
    {
      churchId,
      provider: "facebook",
      accessToken: page.access_token,
      metadata: {
        ...clearReconnectFlags(meta),
        page_id: page.id,
        page_name: page.name,
        long_lived: true,
      },
      connectedBy: integration.connected_by ?? undefined,
    },
    supabase,
  );

  return page.access_token;
}

/**
 * Page access token for the church, re-deriving it once if it has gone stale.
 *
 * Throws `FacebookReconnectRequiredError` only when the long-lived user token
 * is itself dead — the one case where a human really must redo the OAuth flow.
 */
export async function getFacebookPageAccessToken(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<{ token: string; pageId: string }> {
  const integration = await getIntegration(churchId, "facebook", supabase);
  if (!integration) {
    throw new Error("Facebook is not connected");
  }

  const meta = (integration.metadata ?? {}) as FacebookIntegrationMetadata;
  const pageId = meta.page_id;
  if (!pageId) {
    throw new Error("Facebook Page ID is missing. Reconnect Facebook.");
  }

  const stored = integration.access_token?.trim();
  if (stored) return { token: stored, pageId };

  const refreshed = await refreshFacebookPageToken(churchId, supabase);
  if (!refreshed) {
    await markIntegrationNeedsReconnect(
      churchId,
      "facebook",
      "Facebook access expired. Reconnect Facebook in Settings.",
      supabase,
    );
    throw new FacebookReconnectRequiredError();
  }

  return { token: refreshed, pageId };
}
