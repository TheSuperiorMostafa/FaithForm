import type { SupabaseClient } from "@supabase/supabase-js";
import { google, type youtube_v3 } from "googleapis";
import {
  isInvalidGrantError,
  resolveGoogleOAuthRedirectUri,
} from "@/lib/integrations/google-oauth";
import {
  deleteIntegration,
  getIntegration,
  saveIntegration,
} from "@/lib/integrations/tokens";
import type { YouTubeIntegrationMetadata } from "@/lib/integrations/types";
import { setStreamRelayDestination } from "@/lib/stream/relay";

const YOUTUBE_SCOPES = [
  "https://www.googleapis.com/auth/youtube",
  "https://www.googleapis.com/auth/youtube.force-ssl",
  "https://www.googleapis.com/auth/youtube.readonly",
];

export class YouTubeReconnectRequiredError extends Error {
  constructor() {
    super("YouTube access expired. Reconnect YouTube on the Live Stream page.");
    this.name = "YouTubeReconnectRequiredError";
  }
}

/**
 * Redirect URI for the YouTube OAuth flow.
 *
 * Must be byte-identical in the authorization request and the token exchange —
 * Google rejects a mismatch with `invalid_grant`, and an unregistered value
 * with `redirect_uri_mismatch`. `YOUTUBE_REDIRECT_URI` wins when set (an empty
 * string counts as unset), otherwise the flow shares the Google callback.
 */
export function resolveYouTubeOAuthRedirectUri(): string {
  const explicit = process.env.YOUTUBE_REDIRECT_URI?.trim();
  if (explicit) return explicit;
  return resolveGoogleOAuthRedirectUri();
}

function getYouTubeOAuthClient() {
  const clientId =
    process.env.YOUTUBE_CLIENT_ID?.trim() ||
    process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret =
    process.env.YOUTUBE_CLIENT_SECRET?.trim() ||
    process.env.GOOGLE_CLIENT_SECRET?.trim();

  if (!clientId || !clientSecret) {
    throw new Error(
      "YouTube Live OAuth is not configured. Set YOUTUBE_CLIENT_ID/SECRET or reuse GOOGLE_CLIENT_ID/SECRET.",
    );
  }

  return new google.auth.OAuth2(
    clientId,
    clientSecret,
    resolveYouTubeOAuthRedirectUri(),
  );
}

/**
 * Authenticated YouTube client with a guaranteed-live access token.
 *
 * Refreshes are persisted as they happen, and a dead refresh token clears the
 * integration so the UI shows "Connect YouTube" instead of failing every
 * broadcast with an opaque 401.
 */
export async function getYouTubeAuthClient(
  churchId: string,
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

  const persist = async (tokens: {
    access_token?: string | null;
    refresh_token?: string | null;
    expiry_date?: number | null;
  }) => {
    if (!tokens.access_token) return;
    await saveIntegration(
      {
        churchId,
        provider: "youtube",
        accessToken: tokens.access_token,
        refreshToken: tokens.refresh_token ?? integration.refresh_token,
        tokenExpiresAt: tokens.expiry_date
          ? new Date(tokens.expiry_date)
          : integration.token_expires_at
            ? new Date(integration.token_expires_at)
            : null,
        metadata: integration.metadata ?? {},
        connectedBy: integration.connected_by ?? undefined,
      },
      supabase,
    );
  };

  client.on("tokens", (tokens) => {
    void persist(tokens);
  });

  const expiresAt = integration.token_expires_at
    ? new Date(integration.token_expires_at).getTime()
    : 0;
  const needsRefresh =
    !integration.access_token || expiresAt - Date.now() < 60_000;

  if (needsRefresh) {
    if (!integration.refresh_token) {
      await deleteIntegration(churchId, "youtube", supabase);
      throw new YouTubeReconnectRequiredError();
    }
    try {
      await client.getAccessToken();
    } catch (err) {
      if (isInvalidGrantError(err)) {
        await deleteIntegration(churchId, "youtube", supabase);
        throw new YouTubeReconnectRequiredError();
      }
      throw err;
    }
  }

  return { client, integration };
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

type YouTubeClient = ReturnType<typeof google.youtube>;

/**
 * Reuses the church's existing reusable liveStream when possible.
 *
 * A liveStream is a long-lived ingest endpoint; only the broadcast is
 * per-service. Creating a new one every time leaks resources against the
 * channel's quota and changes the RTMP key on every go-live.
 */
async function resolveIngestStream(
  youtube: YouTubeClient,
  existingStreamId: string | undefined,
  title: string,
): Promise<{ streamId: string; rtmpUrl: string }> {
  if (existingStreamId) {
    try {
      const { data } = await youtube.liveStreams.list({
        part: ["cdn", "status"],
        id: [existingStreamId],
      });
      const existing = data.items?.[0];
      const ingestion = existing?.cdn?.ingestionInfo;
      if (existing?.id && ingestion?.ingestionAddress && ingestion?.streamName) {
        return {
          streamId: existing.id,
          rtmpUrl: `${ingestion.ingestionAddress.replace(/\/$/, "")}/${ingestion.streamName}`,
        };
      }
    } catch {
      // Deleted on the channel or no longer readable — fall through and create.
    }
  }

  const { data: streamData } = await youtube.liveStreams.insert({
    part: ["snippet", "cdn", "status"],
    requestBody: {
      snippet: { title: `${title} — FaithForm` },
      cdn: {
        frameRate: "variable",
        ingestionType: "rtmp",
        resolution: "variable",
      },
    },
  });

  const ingestion = streamData.cdn?.ingestionInfo;
  if (!streamData.id || !ingestion?.ingestionAddress || !ingestion?.streamName) {
    throw new Error("YouTube did not return stream ingestion details.");
  }

  return {
    streamId: streamData.id,
    rtmpUrl: `${ingestion.ingestionAddress.replace(/\/$/, "")}/${ingestion.streamName}`,
  };
}

/**
 * Clears broadcasts left bound to the ingest stream by previous services.
 *
 * A reusable liveStream accepts at most three bound broadcasts, and one that is
 * still `live` keeps consuming the feed — so a service that was never closed
 * out swallows the next one's video and the new broadcast never leaves `ready`.
 * The ones that aired are completed; the ones that never received a frame are
 * deleted, since they hold a bind slot and otherwise sit on the channel forever
 * as empty scheduled streams. Only broadcasts bound to FaithForm's own ingest
 * stream are touched. Best effort throughout: a broadcast stuck on YouTube's
 * side must not stop this service from starting.
 */
async function releaseStaleBroadcasts(
  youtube: YouTubeClient,
  streamId: string,
): Promise<void> {
  let items: youtube_v3.Schema$LiveBroadcast[];
  try {
    const parts = ["id", "status", "contentDetails"];
    const [active, upcoming] = await Promise.all([
      youtube.liveBroadcasts.list({ part: parts, broadcastStatus: "active" }),
      youtube.liveBroadcasts.list({ part: parts, broadcastStatus: "upcoming" }),
    ]);
    items = [...(active.data.items ?? []), ...(upcoming.data.items ?? [])];
  } catch {
    return;
  }

  for (const item of items) {
    if (!item.id || item.contentDetails?.boundStreamId !== streamId) continue;

    const lifeCycle = item.status?.lifeCycleStatus;
    try {
      if (lifeCycle === "live" || lifeCycle === "testing") {
        await youtube.liveBroadcasts.transition({
          broadcastStatus: "complete",
          id: item.id,
          part: ["status"],
        });
      } else {
        try {
          await youtube.liveBroadcasts.delete({ id: item.id });
        } catch {
          // Freeing the bind slot is the part that matters. Omitting streamId
          // removes the binding without deleting the broadcast.
          await youtube.liveBroadcasts.bind({
            id: item.id,
            part: ["id", "contentDetails"],
          });
        }
      }
    } catch (err) {
      console.error(
        "releaseStaleBroadcasts:",
        item.id,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

async function provisionYouTubeLiveRtmpUrl(
  client: InstanceType<typeof google.auth.OAuth2>,
  options: {
    channelTitle: string;
    broadcastTitle: string;
    privacyStatus: YouTubePrivacy;
    existingStreamId?: string;
  },
): Promise<{ rtmpUrl: string; streamId: string; broadcastId: string }> {
  const youtube = google.youtube({ version: "v3", auth: client });
  const channelTitle = options.channelTitle.trim() || "FaithForm";
  const broadcastTitle =
    options.broadcastTitle.trim() || `${channelTitle} Live`;

  const { streamId, rtmpUrl } = await resolveIngestStream(
    youtube,
    options.existingStreamId,
    channelTitle,
  );

  await releaseStaleBroadcasts(youtube, streamId);

  const { data: broadcast } = await youtube.liveBroadcasts.insert({
    part: ["snippet", "status", "contentDetails"],
    requestBody: {
      snippet: {
        title: broadcastTitle.slice(0, 100),
        scheduledStartTime: new Date().toISOString(),
      },
      status: {
        privacyStatus: options.privacyStatus,
        selfDeclaredMadeForKids: false,
      },
      contentDetails: {
        // Auto-start takes the broadcast live the moment the bound stream goes
        // active, so no manual transition is needed on the happy path.
        enableAutoStart: true,
        // Auto-stop off, so a brief RTMP gap does not end the service.
        enableAutoStop: false,
        // The monitor (preview) stream forces a ready -> testing -> live path.
        // Disabling it lets auto-start go straight to live.
        monitorStream: {
          enableMonitorStream: false,
          broadcastStreamDelayMs: 0,
        },
      },
    },
  });

  if (!broadcast.id) {
    throw new Error("YouTube did not return a broadcast ID.");
  }

  await youtube.liveBroadcasts.bind({
    part: ["id", "contentDetails"],
    id: broadcast.id,
    streamId,
  });

  return { rtmpUrl, streamId, broadcastId: broadcast.id };
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

  // `longUploadsStatus` says nothing about live eligibility. Probe the live
  // API directly so a channel that has never enabled live streaming is caught
  // at connect time rather than mid-service.
  let canManageLive = true;
  try {
    await youtube.liveBroadcasts.list({
      part: ["id"],
      mine: true,
      maxResults: 1,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (/liveStreamingNotEnabled|not enabled for live/i.test(message)) {
      canManageLive = false;
    }
  }

  const metadata: YouTubeIntegrationMetadata = {
    channel_id: channel?.id ?? undefined,
    channel_title: channelTitle,
    can_manage_live: canManageLive,
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
}

export type YouTubePrivacy = "public" | "unlisted" | "private";

export async function provisionYouTubeLiveForChurch(
  churchId: string,
  userId: string | null,
  supabase?: SupabaseClient,
  options?: { title?: string; privacyStatus?: YouTubePrivacy },
): Promise<{ rtmpUrl: string; broadcastId: string; watchUrl: string }> {
  const { client, integration } = await getYouTubeAuthClient(churchId, supabase);

  const existingMeta = (integration.metadata ?? {}) as YouTubeIntegrationMetadata;
  const channelTitle = existingMeta.channel_title ?? "FaithForm";

  const { rtmpUrl, streamId, broadcastId } = await provisionYouTubeLiveRtmpUrl(
    client,
    {
      channelTitle,
      broadcastTitle: options?.title ?? `${channelTitle} Live`,
      privacyStatus: options?.privacyStatus ?? "public",
      existingStreamId: existingMeta.live_stream_id,
    },
  );

  // Persist only the metadata. The token columns are owned by
  // getYouTubeAuthClient's refresh handler — rewriting them here would put the
  // pre-refresh (expired) access token back into the row.
  const current = await getIntegration(churchId, "youtube", supabase);
  await saveIntegration(
    {
      churchId,
      provider: "youtube",
      accessToken: current?.access_token ?? integration.access_token,
      refreshToken: current?.refresh_token ?? integration.refresh_token,
      tokenExpiresAt: current?.token_expires_at
        ? new Date(current.token_expires_at)
        : integration.token_expires_at
          ? new Date(integration.token_expires_at)
          : null,
      metadata: {
        ...existingMeta,
        live_stream_id: streamId,
        live_broadcast_id: broadcastId,
      },
      connectedBy: integration.connected_by ?? userId ?? undefined,
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

  return {
    rtmpUrl,
    broadcastId,
    watchUrl: `https://www.youtube.com/watch?v=${broadcastId}`,
  };
}
