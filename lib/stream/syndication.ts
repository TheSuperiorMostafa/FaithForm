import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { provisionFacebookLiveForChurch } from "@/lib/integrations/facebook-live";
import { getIntegration } from "@/lib/integrations/tokens";
import type { YouTubeIntegrationMetadata } from "@/lib/integrations/types";
import { provisionYouTubeLiveForChurch } from "@/lib/integrations/youtube-live";
import { google } from "googleapis";
import { resolveGoogleOAuthRedirectUri } from "@/lib/integrations/google-oauth";
import type { StreamEvent } from "@/lib/stream/events";
import { clearStreamRelayDestinations } from "@/lib/stream/relay";

const RETRY_WINDOW_MS = 15 * 60 * 1000;
const RETRY_INTERVAL_MS = 2 * 60 * 1000;

export async function provisionDestinationsForEvent(
  event: StreamEvent,
  userId: string,
  supabase?: SupabaseClient,
): Promise<Array<{ name: string; url: string }>> {
  const client = supabase ?? createAdminClient();
  const destinations: Array<{ name: string; url: string }> = [];

  if (event.syndicateYoutube) {
    await provisionYouTubeLiveForChurch(event.churchId, userId, client);
    const stream = await getIntegration(event.churchId, "stream", client);
    const youtubeUrl = (stream?.metadata as { youtube_url?: string })?.youtube_url;
    if (youtubeUrl) destinations.push({ name: "youtube", url: youtubeUrl });
  }

  if (event.syndicateFacebook) {
    await provisionFacebookLiveForChurch(event.churchId, userId, client);
    const stream = await getIntegration(event.churchId, "stream", client);
    const facebookUrl = (stream?.metadata as { facebook_url?: string })?.facebook_url;
    if (facebookUrl) destinations.push({ name: "facebook", url: facebookUrl });
  }

  return destinations;
}

export async function transitionYouTubeBroadcastLive(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<void> {
  const integration = await getIntegration(churchId, "youtube", supabase);
  if (!integration) return;

  const meta = (integration.metadata ?? {}) as YouTubeIntegrationMetadata;
  const broadcastId = meta.live_broadcast_id;
  if (!broadcastId) return;

  const clientId =
    process.env.YOUTUBE_CLIENT_ID?.trim() ?? process.env.GOOGLE_CLIENT_ID?.trim();
  const clientSecret =
    process.env.YOUTUBE_CLIENT_SECRET?.trim() ??
    process.env.GOOGLE_CLIENT_SECRET?.trim();
  if (!clientId || !clientSecret) return;

  const client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    resolveGoogleOAuthRedirectUri(),
  );
  client.setCredentials({
    access_token: integration.access_token,
    refresh_token: integration.refresh_token ?? undefined,
    expiry_date: integration.token_expires_at
      ? new Date(integration.token_expires_at).getTime()
      : undefined,
  });

  const youtube = google.youtube({ version: "v3", auth: client });
  try {
    await youtube.liveBroadcasts.transition({
      broadcastStatus: "testing",
      id: broadcastId,
      part: ["status"],
    });
    await youtube.liveBroadcasts.transition({
      broadcastStatus: "live",
      id: broadcastId,
      part: ["status"],
    });
  } catch {
    // YouTube may auto-transition with enableAutoStart
  }
}

export async function recordSyndicationAttempt(
  streamEventId: string,
  platform: "youtube" | "facebook",
  status: "pending" | "success" | "failed",
  errorMessage?: string,
  supabase?: SupabaseClient,
) {
  const client = supabase ?? createAdminClient();
  await client.from("stream_syndication_attempts").insert({
    stream_event_id: streamEventId,
    platform,
    status,
    error_message: errorMessage ?? null,
  });
}

export async function retryPendingSyndication(
  supabase?: SupabaseClient,
): Promise<{ retried: number }> {
  const client = supabase ?? createAdminClient();
  const now = new Date().toISOString();

  const { data: events, error } = await client
    .from("stream_events")
    .select("*")
    .eq("status", "live")
    .not("syndication_retry_until", "is", null)
    .gte("syndication_retry_until", now);

  if (error || !events?.length) return { retried: 0 };

  let retried = 0;
  for (const row of events) {
    const event = row as {
      id: string;
      church_id: string;
      syndicate_youtube: boolean;
      syndicate_facebook: boolean;
      created_by: string | null;
    };

    const { data: attempts } = await client
      .from("stream_syndication_attempts")
      .select("platform, status, attempted_at")
      .eq("stream_event_id", event.id)
      .order("attempted_at", { ascending: false });

    const lastYoutube = attempts?.find((a) => a.platform === "youtube");
    const lastFacebook = attempts?.find((a) => a.platform === "facebook");

    if (
      event.syndicate_youtube &&
      lastYoutube?.status !== "success" &&
      shouldRetry(lastYoutube?.attempted_at)
    ) {
      try {
        await provisionYouTubeLiveForChurch(
          event.church_id,
          event.created_by ?? event.church_id,
          client,
        );
        await recordSyndicationAttempt(event.id, "youtube", "success", undefined, client);
        retried++;
      } catch (err) {
        await recordSyndicationAttempt(
          event.id,
          "youtube",
          "failed",
          err instanceof Error ? err.message : "retry failed",
          client,
        );
      }
    }

    if (
      event.syndicate_facebook &&
      lastFacebook?.status !== "success" &&
      shouldRetry(lastFacebook?.attempted_at)
    ) {
      try {
        await provisionFacebookLiveForChurch(
          event.church_id,
          event.created_by ?? event.church_id,
          client,
        );
        await recordSyndicationAttempt(event.id, "facebook", "success", undefined, client);
        retried++;
      } catch (err) {
        await recordSyndicationAttempt(
          event.id,
          "facebook",
          "failed",
          err instanceof Error ? err.message : "retry failed",
          client,
        );
      }
    }
  }

  return { retried };
}

function shouldRetry(lastAttemptAt?: string): boolean {
  if (!lastAttemptAt) return true;
  return Date.now() - new Date(lastAttemptAt).getTime() >= RETRY_INTERVAL_MS;
}

export function syndicationRetryUntil(): string {
  return new Date(Date.now() + RETRY_WINDOW_MS).toISOString();
}

export async function clearRelayDestinations(
  churchId: string,
  userId: string,
  supabase?: SupabaseClient,
) {
  await clearStreamRelayDestinations(churchId, userId, supabase);
}
