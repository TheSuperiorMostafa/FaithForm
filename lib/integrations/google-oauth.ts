import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import {
  clearReconnectFlags,
  getIntegration,
  markIntegrationNeedsReconnect,
  saveIntegration,
} from "@/lib/integrations/tokens";
import type { GoogleIntegrationMetadata } from "@/lib/integrations/types";
import { absoluteAppPath } from "@/lib/site-url";

/**
 * Refresh this far ahead of expiry.
 *
 * Five minutes rather than one: a token that expires mid-request is
 * indistinguishable from a revoked one at the call site, and the old margin
 * left no room for clock skew between this host and Google.
 */
export const REFRESH_SKEW_MS = 5 * 60_000;

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/userinfo.email",
];

/**
 * Shared redirect URI for all Google OAuth flows (Calendar, YouTube Live, etc.).
 * GOOGLE_REDIRECT_URI wins when set to a real value, but an empty string must be
 * treated as unset (a relative redirect URI silently breaks the token exchange
 * and surfaces as `invalid_grant`). Falls back to the canonical site origin.
 */
export function resolveGoogleOAuthRedirectUri(): string {
  const explicit = process.env.GOOGLE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return absoluteAppPath("/api/integrations/google/callback");
}

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth is not configured");
  }

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    resolveGoogleOAuthRedirectUri(),
  );
}

/** Google rejects dead/expired/revoked refresh tokens with `invalid_grant`. */
export function isInvalidGrantError(error: unknown): boolean {
  if (!error) return false;
  const anyErr = error as {
    message?: string;
    response?: { data?: { error?: string } };
  };
  if (anyErr.response?.data?.error === "invalid_grant") return true;
  return Boolean(anyErr.message?.toLowerCase().includes("invalid_grant"));
}

type RefreshableClient = { getAccessToken: () => Promise<unknown> };

/**
 * Refreshes an access token, retrying once on a transient failure.
 *
 * Google's token endpoint returns the occasional 5xx or drops the connection.
 * Without a retry those blips were indistinguishable from a dead grant and
 * escalated into a full disconnect, so a single backed-off attempt is worth it.
 * `invalid_grant` is a real verdict and is rethrown immediately.
 */
export async function refreshWithRetry(
  client: RefreshableClient,
): Promise<void> {
  try {
    await client.getAccessToken();
  } catch (err) {
    if (isInvalidGrantError(err)) throw err;
    await new Promise((resolve) => setTimeout(resolve, 500));
    await client.getAccessToken();
  }
}

/**
 * Reads the Google integration and forces a token refresh when the access token
 * is missing or expired. If the refresh token is dead (`invalid_grant`), the
 * integration row is removed so the UI reflects a disconnected state and the
 * caller gets a clear, actionable error instead of a confusing "connected but
 * broken" state.
 */
export class GoogleReconnectRequiredError extends Error {
  constructor() {
    super("Google access expired. Reconnect Google in Settings.");
    this.name = "GoogleReconnectRequiredError";
  }
}

export function getGoogleAuthUrl(state: string): string {
  const client = getOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
    state,
  });
}

export async function exchangeGoogleCode(
  code: string,
  churchId: string,
  userId: string,
  supabase?: SupabaseClient,
) {
  const client = getOAuthClient();
  const { tokens } = await client.getToken(code);

  if (!tokens.access_token) {
    throw new Error("Google did not return an access token");
  }

  client.setCredentials(tokens);

  const oauth2 = google.oauth2({ version: "v2", auth: client });
  const { data: userInfo } = await oauth2.userinfo.get();

  // Reconnecting must not reset the church's calendar selection.
  const existing = await getIntegration(churchId, "google", supabase);
  const existingMeta = clearReconnectFlags(
    existing?.metadata,
  ) as GoogleIntegrationMetadata;

  const metadata: GoogleIntegrationMetadata = {
    ...existingMeta,
    email: userInfo.email ?? existingMeta.email,
    calendar_id: existingMeta.calendar_id ?? "primary",
    connected_at: new Date().toISOString(),
  };

  await saveIntegration(
    {
      churchId,
      provider: "google",
      accessToken: tokens.access_token,
      // Google omits the refresh token when it decides one is already held;
      // `undefined` keeps the stored one rather than blanking it.
      refreshToken: tokens.refresh_token ?? undefined,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      metadata,
      connectedBy: userId,
    },
    supabase,
  );
}

export async function getGoogleAuthClient(
  churchId: string,
  supabase?: SupabaseClient,
) {
  const integration = await getIntegration(churchId, "google", supabase);
  if (!integration) {
    throw new Error(
      "Google is not connected. Connect Google in Settings as a church admin.",
    );
  }

  const client = getOAuthClient();
  client.setCredentials({
    access_token: integration.access_token,
    refresh_token: integration.refresh_token ?? undefined,
    expiry_date: integration.token_expires_at
      ? new Date(integration.token_expires_at).getTime()
      : undefined,
  });

  const persistCredentials = async () => {
    const creds = client.credentials;
    if (!creds.access_token) return;
    await saveIntegration(
      {
        churchId,
        provider: "google",
        accessToken: creds.access_token,
        refreshToken: creds.refresh_token ?? integration.refresh_token,
        // `undefined` keeps the stored expiry. Writing null here forced a
        // refresh on every single request.
        tokenExpiresAt: creds.expiry_date
          ? new Date(creds.expiry_date)
          : undefined,
        metadata: clearReconnectFlags(integration.metadata),
        connectedBy: integration.connected_by ?? undefined,
      },
      supabase,
    );
  };

  // Catches refreshes googleapis performs on its own later in the request.
  // Fire-and-forget by necessity — the emitter does not await listeners — so
  // the deterministic write below is what the proactive path relies on.
  client.on("tokens", () => {
    void persistCredentials().catch((err) => {
      console.error("google token persist (event):", err);
    });
  });

  // Proactively ensure we hold a live access token. This forces a refresh when
  // expired and lets us convert a dead refresh token into a clean, actionable
  // "reconnect required" state instead of a mid-request Google API failure.
  const expiresAt = integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : 0;
  const needsRefresh =
    !integration.access_token || expiresAt - Date.now() < REFRESH_SKEW_MS;

  if (needsRefresh) {
    if (!integration.refresh_token) {
      await markIntegrationNeedsReconnect(
        churchId,
        "google",
        "Google did not return a refresh token. Reconnect Google in Settings.",
        supabase,
      );
      throw new GoogleReconnectRequiredError();
    }

    try {
      await refreshWithRetry(client);
    } catch (err) {
      if (isInvalidGrantError(err)) {
        await markIntegrationNeedsReconnect(
          churchId,
          "google",
          "Google access was revoked or expired. Reconnect Google in Settings.",
          supabase,
        );
        throw new GoogleReconnectRequiredError();
      }
      throw err;
    }

    // Awaited on purpose: the `tokens` listener above cannot be awaited, and on
    // serverless the instance freezes the moment the response is sent. Losing
    // this write meant losing a rotated refresh token — the next request then
    // failed with invalid_grant and the integration looked self-disconnecting.
    await persistCredentials();
  }

  return client;
}
