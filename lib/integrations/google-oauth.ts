import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import {
  getIntegration,
  saveIntegration,
} from "@/lib/integrations/tokens";
import type { GoogleIntegrationMetadata } from "@/lib/integrations/types";

const SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/gmail.compose",
  "https://www.googleapis.com/auth/userinfo.email",
];

function getOAuthClient() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  const redirectUri =
    process.env.GOOGLE_REDIRECT_URI ??
    `${process.env.NEXT_PUBLIC_SITE_URL}/api/integrations/google/callback`;

  if (!clientId || !clientSecret) {
    throw new Error("Google OAuth is not configured");
  }

  return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
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

  return client;
}
