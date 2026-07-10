import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import {
  deleteIntegration,
  getIntegration,
  saveIntegration,
} from "@/lib/integrations/tokens";
import type { GoogleIntegrationMetadata } from "@/lib/integrations/types";
import { absoluteAppPath } from "@/lib/site-url";

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

  const metadata: GoogleIntegrationMetadata = {
    email: userInfo.email ?? undefined,
    calendar_id: "primary",
  };

  await saveIntegration(
    {
      churchId,
      provider: "google",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
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

  client.on("tokens", async (tokens) => {
    if (!tokens.access_token) return;
    await saveIntegration(
      {
        churchId,
        provider: "google",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? integration.refresh_token,
        tokenExpiresAt: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : null,
        metadata: integration.metadata,
        connectedBy: integration.connected_by ?? undefined,
      },
      supabase,
    );
  });

  // Proactively ensure we hold a live access token. This forces a refresh when
  // expired and lets us convert a dead refresh token into a clean, actionable
  // "reconnect required" state instead of a mid-request Google API failure.
  const expiresAt = integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : 0;
  const needsRefresh = !integration.access_token || expiresAt - Date.now() < 60_000;

  if (needsRefresh) {
    if (!integration.refresh_token) {
      await deleteIntegration(churchId, "google", supabase);
      throw new GoogleReconnectRequiredError();
    }
    try {
      await client.getAccessToken();
    } catch (err) {
      if (isInvalidGrantError(err)) {
        await deleteIntegration(churchId, "google", supabase);
        throw new GoogleReconnectRequiredError();
      }
      throw err;
    }
  }

  return client;
}
