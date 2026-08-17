import {
  exchangeForLongLivedUserToken,
  refreshFacebookPageToken,
} from "@/lib/integrations/facebook-token";
import { getGoogleAuthClient } from "@/lib/integrations/google-oauth";
import { getIntegration, saveIntegration } from "@/lib/integrations/tokens";
import type { FacebookIntegrationMetadata } from "@/lib/integrations/types";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Keeps connected integrations alive.
 *
 * Every refresh path in the app is reactive: a token is renewed at the moment
 * something needs it. That is fine for a church that streams every Sunday and
 * useless for one that doesn't — Facebook's long-lived user token lasts about
 * sixty days and is never extended unless it is used, and Google retires a
 * refresh token that has sat idle for six months. Either way the church finds
 * out at the worst possible moment: the morning they try to go live.
 *
 * So a nightly pass touches each connection before anything is asked of it.
 * Everything here is best effort and per-church isolated — one dead grant must
 * not stop the rest of the sweep.
 */

/** Re-exchange a long-lived token this far before it lapses. */
const FACEBOOK_RENEW_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

export type KeepAliveResult = {
  checked: number;
  refreshed: number;
  needsReconnect: number;
  errors: Array<{ churchId: string; provider: string; error: string }>;
};

/**
 * Trades a still-valid long-lived user token for a fresh sixty-day one.
 *
 * Facebook allows this with the long-lived token itself, so the connection can
 * roll forward indefinitely without a human ever revisiting the OAuth screen.
 */
async function renewFacebook(
  churchId: string,
  result: KeepAliveResult,
): Promise<void> {
  const integration = await getIntegration(churchId, "facebook");
  const userToken = integration?.refresh_token?.trim();
  if (!integration || !userToken) return;

  const expiresAt = integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : null;

  // An expiry we cannot see is treated as due: better a wasted exchange than a
  // connection that quietly lapses.
  const due =
    expiresAt === null || expiresAt - Date.now() < FACEBOOK_RENEW_WINDOW_MS;
  if (!due) return;

  const renewed = await exchangeForLongLivedUserToken(userToken);

  // The helper falls back to returning its input when Facebook refuses. An
  // unchanged token with no new expiry means nothing was renewed.
  if (renewed.token === userToken && !renewed.expiresAt) {
    result.needsReconnect += 1;
    return;
  }

  const meta = (integration.metadata ?? {}) as FacebookIntegrationMetadata;
  await saveIntegration({
    churchId,
    provider: "facebook",
    accessToken: integration.access_token,
    refreshToken: renewed.token,
    tokenExpiresAt: renewed.expiresAt,
    metadata: { ...meta, long_lived: true },
    connectedBy: integration.connected_by ?? undefined,
  });

  // The Page token inherits the user token's lifetime, so re-derive it from the
  // one we just minted.
  await refreshFacebookPageToken(churchId);
  result.refreshed += 1;
}

/**
 * Forces a Google access-token refresh, which also counts as use and keeps the
 * refresh token from ageing out.
 */
async function renewGoogle(
  churchId: string,
  result: KeepAliveResult,
): Promise<void> {
  // getGoogleAuthClient refreshes when the token is near expiry and persists
  // whatever it gets, including a rotated refresh token.
  await getGoogleAuthClient(churchId);
  result.refreshed += 1;
}

export async function refreshExpiringIntegrations(): Promise<KeepAliveResult> {
  const result: KeepAliveResult = {
    checked: 0,
    refreshed: 0,
    needsReconnect: 0,
    errors: [],
  };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("church_integrations")
    .select("church_id, provider")
    .in("provider", ["google", "facebook", "youtube"]);

  if (error || !data?.length) return result;

  for (const row of data) {
    const churchId = row.church_id as string;
    const provider = row.provider as string;
    result.checked += 1;

    try {
      if (provider === "facebook") {
        await renewFacebook(churchId, result);
      } else {
        // YouTube rides on the same Google grant.
        await renewGoogle(churchId, result);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "refresh failed";

      // A grant that genuinely needs a human is a reportable state, not an
      // error — the church already sees "reconnect" in Settings.
      if (/reconnect/i.test(message)) {
        result.needsReconnect += 1;
      } else {
        result.errors.push({ churchId, provider, error: message });
      }
    }
  }

  return result;
}
