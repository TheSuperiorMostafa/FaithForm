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

export type FacebookPage = { id: string; name: string; access_token?: string };

type FacebookPageResponse = {
  data?: FacebookPage[];
  error?: { message: string };
  paging?: { cursors?: { after?: string } };
};

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

  let res: Response;
  try {
    res = await fetch(
      `${GRAPH}/oauth/access_token?${new URLSearchParams({
        grant_type: "fb_exchange_token",
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: shortLivedToken,
      })}`,
    );
  } catch {
    // A temporary network failure should not discard the token Facebook just
    // issued. The connection can still be completed with a short-lived token.
    return { token: shortLivedToken, expiresAt: null };
  }

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

async function fetchFacebookPageEdge(
  userToken: string,
  edge: "accounts" | "assigned_pages",
): Promise<FacebookPage[]> {
  const pages = new Map<string, FacebookPage>();
  let after: string | undefined;

  // Facebook paginates both User Page edges. Bound the loop to avoid spending
  // a serverless request indefinitely on a malformed paging cursor.
  for (let pageNumber = 0; pageNumber < 10; pageNumber += 1) {
    const params = new URLSearchParams({
      access_token: userToken,
      fields: "id,name,access_token",
      limit: "100",
    });
    if (after) params.set("after", after);

    const res = await fetch(`${GRAPH}/me/${edge}?${params}`);
    const data = (await res.json().catch(() => ({}))) as FacebookPageResponse;

    if (!res.ok) {
      throw new Error(data.error?.message ?? "Could not read Facebook Pages");
    }

    const batch = data.data ?? [];
    for (const page of batch) {
      if (page.id && page.name) pages.set(page.id, page);
    }

    const nextAfter = data.paging?.cursors?.after;
    if (batch.length === 0 || !nextAfter || nextAfter === after) break;
    after = nextAfter;
  }

  return [...pages.values()];
}

/**
 * Finds Pages the person can post as, including Pages assigned through a Meta
 * Business Portfolio. Meta returns an empty /me/accounts response for the
 * latter in some otherwise-valid full-control setups; /me/assigned_pages is
 * the matching Business-user edge.
 */
export async function fetchFacebookPages(
  userToken: string,
): Promise<FacebookPage[]> {
  const managedPages = await fetchFacebookPageEdge(userToken, "accounts");
  if (managedPages.length > 0) return managedPages;

  try {
    return await fetchFacebookPageEdge(userToken, "assigned_pages");
  } catch (error) {
    // /me/accounts was a valid, empty response. Keep that user-facing outcome
    // when Business access is absent rather than replacing it with a raw Graph
    // permission failure. The callback diagnostics still contain granted scopes.
    console.info("Facebook connection: assigned Page lookup unavailable", {
      reason: error instanceof Error ? error.message : "Unknown response",
    });
    return [];
  }
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
