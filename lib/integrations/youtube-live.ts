import type { SupabaseClient } from "@supabase/supabase-js";
import { google } from "googleapis";
import { resolveGoogleOAuthRedirectUri } from "@/lib/integrations/google-oauth";
import {
  formatYouTubeLiveError,
  isYouTubeLiveStreamingNotEnabledError,
} from "@/lib/integrations/youtube-errors";
import { getIntegration, saveIntegration } from "@/lib/integrations/tokens";
import type { YouTubeIntegrationMetadata } from "@/lib/integrations/types";
import { setStreamRelayDestination } from "@/lib/stream/relay";

const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtube.readonly",
];

function getYouTubeOAuthClient() {
  const clientId =
    process.env.YOUTUBE_CLIENT_ID?.trim() ??
    process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret =
    process.env.YOUTUBE_CLIENT_SECRET?.trim() ??
    process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error(
      "YouTube Live OAuth is not configured. Set YOUTUBE_CLIENT_ID/SECRET or reuse GOOGLE_CLIENT_ID/SECRET.",
    );
  }

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    resolveGoogleOAuthRedirectUri(),
  );
}

export function getYouTubeAuthUrl(state: string): string {
  const client = getYouTubeOAuthClient();
  return client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: YOUTUBE_SCOPES,
    state,
  });
}

async function provisionYouTubeLiveRtmpUrl(
  client: InstanceType<typeof google.auth.OAuth2>,
  channelTitle: string,
): Promise<{ rtmpUrl: string; streamId: string; broadcastId: string }> {
  const youtube = google.youtube({ version: "v3", auth: client });
  const title = channelTitle.trim() || "FaithForm";

  const { data: streamData } = await youtube.liveStreams.insert({
    part: ["snippet", "cdn", "status"],
    requestBody: {
      snippet: {
        title: `${title} — FaithForm`,
      },
      cdn: {
        frameRate: "variable",
        ingestionType: "rtmp",
        resolution: "variable",
      },
    },
  });

  const ingestion = streamData.cdn?.ingestionInfo;
  if (!ingestion?.ingestionAddress || !ingestion?.streamName) {
    throw new Error("YouTube did not return stream ingestion details.");
  }

  const base = ingestion.ingestionAddress.replace(/\/$/, "");
  const rtmpUrl = `${base}/${ingestion.streamName}`;

  const { data: broadcast } = await youtube.liveBroadcasts.insert({
    part: ["snippet", "status", "contentDetails"],
    requestBody: {
      snippet: {
        title: `${title} Live`,
        scheduledStartTime: new Date().toISOString(),
      },
      status: {
        privacyStatus: "public",
      },
      contentDetails: {
        // Auto-start when RTMP arrives; do NOT auto-stop — brief relay/
        // network gaps would end the YouTube broadcast (~1 min idle) and
        // look like a permanent drop/reconnect loop for viewers.
        enableAutoStart: true,
        enableAutoStop: false,
      },
    },
  });

  if (!broadcast.id || !streamData.id) {
    throw new Error("YouTube did not return broadcast or stream IDs.");
  }

  await youtube.liveBroadcasts.bind({
    part: ["id"],
    id: broadcast.id,
    streamId: streamData.id,
  });

  return {
    rtmpUrl,
    streamId: streamData.id,
    broadcastId: broadcast.id,
  };
}

export async function exchangeYouTubeCode(
  code: string,
  churchId: string,
  userId: string,
  supabase?: SupabaseClient,
) {
  const client = getYouTubeOAuthClient();
  const { tokens } = await client.getToken(code);
  if (!tokens.access_token) {
    throw new Error("YouTube did not return an access token");
  }

  client.setCredentials(tokens);
  const youtube = google.youtube({ version: "v3", auth: client });
  const { data } = await youtube.channels.list({
    part: ["id", "snippet", "status"],
    mine: true,
    maxResults: 1,
  });

  const channel = data.items?.[0];
  const channelTitle = channel?.snippet?.title ?? "FaithForm";

  const metadata: YouTubeIntegrationMetadata = {
    channel_id: channel?.id ?? undefined,
    channel_title: channelTitle,
    can_manage_live: true,
    live_streaming_enabled: undefined,
    live_streaming_error: null,
  };

  await saveIntegration(
    {
      churchId,
      provider: "youtube",
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
      metadata,
      connectedBy: userId,
    },
    supabase,
  );

  try {
    await probeYouTubeLiveStreamingEnabled(client, channelTitle);
    await saveIntegration(
      {
        churchId,
        provider: "youtube",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        metadata: {
          ...metadata,
          live_streaming_enabled: true,
          live_streaming_error: null,
        },
        connectedBy: userId,
      },
      supabase,
    );
  } catch (error) {
    const message = formatYouTubeLiveError(error);
    await saveIntegration(
      {
        churchId,
        provider: "youtube",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? null,
        tokenExpiresAt: tokens.expiry_date ? new Date(tokens.expiry_date) : null,
        metadata: {
          ...metadata,
          can_manage_live: false,
          live_streaming_enabled: false,
          live_streaming_error: message,
        },
        connectedBy: userId,
      },
      supabase,
    );
  }
}

async function probeYouTubeLiveStreamingEnabled(
  client: InstanceType<typeof google.auth.OAuth2>,
  channelTitle: string,
): Promise<void> {
  const youtube = google.youtube({ version: "v3", auth: client });
  const title = channelTitle.trim() || "FaithForm";

  const { data } = await youtube.liveStreams.insert({
    part: ["snippet", "cdn", "status"],
    requestBody: {
      snippet: {
        title: `${title} — FaithForm setup check`,
      },
      cdn: {
        frameRate: "variable",
        ingestionType: "rtmp",
        resolution: "variable",
      },
    },
  });

  if (data.id) {
    await youtube.liveStreams.delete({ id: data.id });
  }
}

export async function provisionYouTubeLiveForChurch(
  churchId: string,
  userId: string,
  supabase?: SupabaseClient,
) {
  const integration = await getIntegration(churchId, "youtube", supabase);
  if (!integration) {
    throw new Error("YouTube is not connected. Connect YouTube first.");
  }

  const client = getYouTubeOAuthClient();
  client.setCredentials({
    access_token: integration.access_token,
    refresh_token: integration.refresh_token ?? undefined,
    expiry_date: integration.token_expires_at
      ? new Date(integration.token_expires_at).getTime()
      : undefined,
  });

  const { credentials } = await client.refreshAccessToken().catch(() => ({
    credentials: {
      access_token: integration.access_token,
      refresh_token: integration.refresh_token ?? undefined,
      expiry_date: integration.token_expires_at
        ? new Date(integration.token_expires_at).getTime()
        : undefined,
    },
  }));

  if (credentials.access_token && credentials.access_token !== integration.access_token) {
    await saveIntegration(
      {
        churchId,
        provider: "youtube",
        accessToken: credentials.access_token,
        refreshToken: credentials.refresh_token ?? integration.refresh_token,
        tokenExpiresAt: credentials.expiry_date
          ? new Date(credentials.expiry_date)
          : integration.token_expires_at
            ? new Date(integration.token_expires_at)
            : null,
        metadata: integration.metadata ?? {},
        connectedBy: integration.connected_by ?? userId,
      },
      supabase,
    );
    client.setCredentials(credentials);
  }

  const existingMeta = (integration.metadata ?? {}) as YouTubeIntegrationMetadata;
  const channelTitle = existingMeta.channel_title ?? "FaithForm";

  try {
    const { rtmpUrl, streamId, broadcastId } = await provisionYouTubeLiveRtmpUrl(
      client,
      channelTitle,
    );

    await saveIntegration(
      {
        churchId,
        provider: "youtube",
        accessToken: credentials.access_token ?? integration.access_token,
        refreshToken: credentials.refresh_token ?? integration.refresh_token,
        tokenExpiresAt: credentials.expiry_date
          ? new Date(credentials.expiry_date)
          : integration.token_expires_at
            ? new Date(integration.token_expires_at)
            : null,
        metadata: {
          ...existingMeta,
          can_manage_live: true,
          live_streaming_enabled: true,
          live_streaming_error: null,
          live_stream_id: streamId,
          live_broadcast_id: broadcastId,
        },
        connectedBy: integration.connected_by ?? userId,
      },
      supabase,
    );

    await setStreamRelayDestination(
      churchId,
      "youtube",
      rtmpUrl,
      userId,
      supabase,
    );
  } catch (error) {
    const message = formatYouTubeLiveError(error);
    await saveIntegration(
      {
        churchId,
        provider: "youtube",
        accessToken: credentials.access_token ?? integration.access_token,
        refreshToken: credentials.refresh_token ?? integration.refresh_token,
        tokenExpiresAt: credentials.expiry_date
          ? new Date(credentials.expiry_date)
          : integration.token_expires_at
            ? new Date(integration.token_expires_at)
            : null,
        metadata: {
          ...existingMeta,
          can_manage_live: !isYouTubeLiveStreamingNotEnabledError(error),
          live_streaming_enabled: false,
          live_streaming_error: message,
        },
        connectedBy: integration.connected_by ?? userId,
      },
      supabase,
    );
    throw new Error(message);
  }
}
