import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { provisionFacebookLiveForChurch } from "@/lib/integrations/facebook-live";
import { getIntegration, saveIntegration } from "@/lib/integrations/tokens";
import type { YouTubeIntegrationMetadata } from "@/lib/integrations/types";
import {
  getYouTubeAuthClient,
  provisionYouTubeLiveForChurch,
} from "@/lib/integrations/youtube-live";
import { google } from "googleapis";
import type { StreamEvent } from "@/lib/stream/events";
import {
  clearStreamRelayDestinations,
  getStreamRelaySettings,
} from "@/lib/stream/relay";

const RETRY_WINDOW_MS = 15 * 60 * 1000;
const RETRY_INTERVAL_MS = 2 * 60 * 1000;

export type SyndicationPlatform = "youtube" | "facebook";

export type ProvisionResult = {
  destinations: Array<{ name: string; url: string }>;
  errors: Partial<Record<SyndicationPlatform, string>>;
};

function errorMessage(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message.trim()) return err.message;
  return fallback;
}

/**
 * Provisions RTMP destinations for the platforms this event syndicates to.
 *
 * Each platform is isolated: one failing must not stop the other, and must not
 * stop the broadcast itself. Failures come back as messages so the caller can
 * record them for the retry job and show them to the operator.
 */
export async function provisionDestinationsForEvent(
  event: StreamEvent,
  userId: string | null,
  supabase?: SupabaseClient,
): Promise<ProvisionResult> {
  const client = supabase ?? createAdminClient();
  const destinations: Array<{ name: string; url: string }> = [];
  const errors: Partial<Record<SyndicationPlatform, string>> = {};

  if (event.syndicateYoutube) {
    try {
      await provisionYouTubeLiveForChurch(event.churchId, userId, client, {
        title: event.title,
        privacyStatus: event.youtubePrivacy,
      });
      const stream = await getIntegration(event.churchId, "stream", client);
      const youtubeUrl = (stream?.metadata as { youtube_url?: string })
        ?.youtube_url;
      if (youtubeUrl) {
        destinations.push({ name: "youtube", url: youtubeUrl });
      } else {
        errors.youtube = "YouTube did not return an RTMP destination.";
      }
    } catch (err) {
      errors.youtube = errorMessage(err, "YouTube provisioning failed.");
    }
  }

  if (event.syndicateFacebook) {
    try {
      await provisionFacebookLiveForChurch(event.churchId, userId, client);
      const stream = await getIntegration(event.churchId, "stream", client);
      const facebookUrl = (stream?.metadata as { facebook_url?: string })
        ?.facebook_url;
      if (facebookUrl) {
        destinations.push({ name: "facebook", url: facebookUrl });
      } else {
        errors.facebook = "Facebook did not return an RTMP destination.";
      }
    } catch (err) {
      errors.facebook = errorMessage(err, "Facebook provisioning failed.");
    }
  }

  return { destinations, errors };
}

/**
 * Nudges the bound broadcast to `live`.
 *
 * Broadcasts are created with `enableAutoStart`, so YouTube normally promotes
 * them on its own the moment ingest goes active — this is a fallback for when
 * that does not happen. It checks the current status first, because
 * transitioning a broadcast that is already live returns `redundantTransition`
 * and transitioning one whose stream has not connected yet returns
 * `errorStreamInactive`. Both are expected, not failures.
 */
export async function transitionYouTubeBroadcastLive(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const integration = await getIntegration(churchId, "youtube", supabase);
  if (!integration) return { ok: false, error: "YouTube is not connected." };

  const meta = (integration.metadata ?? {}) as YouTubeIntegrationMetadata;
  const broadcastId = meta.live_broadcast_id;
  if (!broadcastId) {
    return { ok: false, error: "No YouTube broadcast has been provisioned." };
  }

  try {
    const { client } = await getYouTubeAuthClient(churchId, supabase);
    const youtube = google.youtube({ version: "v3", auth: client });

    const { data } = await youtube.liveBroadcasts.list({
      part: ["status"],
      id: [broadcastId],
    });

    const lifeCycle = data.items?.[0]?.status?.lifeCycleStatus ?? undefined;

    // Already where we want it (or on the way there).
    if (lifeCycle === "live" || lifeCycle === "liveStarting") {
      return { ok: true, status: lifeCycle };
    }
    if (lifeCycle === "complete" || lifeCycle === "revoked") {
      return { ok: false, status: lifeCycle, error: `Broadcast is ${lifeCycle}.` };
    }

    await youtube.liveBroadcasts.transition({
      broadcastStatus: "live",
      id: broadcastId,
      part: ["status"],
    });

    return { ok: true, status: "live" };
  } catch (err) {
    const message = err instanceof Error ? err.message : "transition failed";

    // Auto-start will take care of it once the encoder actually connects.
    if (/errorStreamInactive|redundantTransition|invalidTransition/i.test(message)) {
      return { ok: true, status: "pending_ingest" };
    }

    console.error("transitionYouTubeBroadcastLive:", message);
    return { ok: false, error: message };
  }
}

/**
 * Closes out the church's current broadcast when the service ends.
 *
 * YouTube will not do this for us. `enableAutoStop` is off so that a brief RTMP
 * gap cannot end a service, which also means a finished service stays `live`
 * indefinitely. Left open it keeps consuming the reusable ingest stream, and
 * next week's broadcast never starts — the video lands on this one instead.
 */
export async function completeYouTubeBroadcast(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<{ ok: boolean; status?: string; error?: string }> {
  const integration = await getIntegration(churchId, "youtube", supabase);
  if (!integration) return { ok: false, error: "YouTube is not connected." };

  const meta = (integration.metadata ?? {}) as YouTubeIntegrationMetadata;
  const broadcastId = meta.live_broadcast_id;
  if (!broadcastId) return { ok: true, status: "no_broadcast" };

  let result: { ok: boolean; status?: string; error?: string } = {
    ok: true,
    status: "complete",
  };

  try {
    const { client } = await getYouTubeAuthClient(churchId, supabase);
    const youtube = google.youtube({ version: "v3", auth: client });

    const { data } = await youtube.liveBroadcasts.list({
      part: ["status"],
      id: [broadcastId],
    });
    const lifeCycle = data.items?.[0]?.status?.lifeCycleStatus ?? undefined;

    if (lifeCycle === "live" || lifeCycle === "testing") {
      await youtube.liveBroadcasts.transition({
        broadcastStatus: "complete",
        id: broadcastId,
        part: ["status"],
      });
    } else if (lifeCycle !== "complete" && lifeCycle !== "revoked") {
      // Never received a frame, so there is no recording and nothing to keep.
      // Left in place it stays on the channel as an empty scheduled stream —
      // the "waiting for FaithForm" placeholder congregations kept finding —
      // and holds one of the ingest stream's three bind slots, so after three
      // abandoned attempts binding fails outright and no service can start.
      try {
        await youtube.liveBroadcasts.delete({ id: broadcastId });
        result = { ok: true, status: "deleted" };
      } catch (err) {
        // Deletion is the tidy outcome, not a required one. Unbinding still
        // frees the slot, which is what actually blocks the next service.
        console.error(
          "completeYouTubeBroadcast: delete",
          err instanceof Error ? err.message : err,
        );
        await youtube.liveBroadcasts.bind({
          id: broadcastId,
          part: ["id", "contentDetails"],
        });
        result = { ok: true, status: lifeCycle ?? "unbound" };
      }
    } else {
      result = { ok: true, status: lifeCycle };
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : "complete failed";
    if (!/redundantTransition|invalidTransition|liveBroadcastNotFound/i.test(message)) {
      console.error("completeYouTubeBroadcast:", message);
      result = { ok: false, error: message };
    }
  }

  // Drop the pointer regardless of outcome. The next service provisions its own
  // broadcast, and a stale id here would send the next end-of-service at a
  // broadcast that is already gone.
  const current = await getIntegration(churchId, "youtube", supabase);
  if (current) {
    const currentMeta = (current.metadata ?? {}) as YouTubeIntegrationMetadata;
    await saveIntegration(
      {
        churchId,
        provider: "youtube",
        accessToken: current.access_token,
        refreshToken: current.refresh_token,
        tokenExpiresAt: current.token_expires_at
          ? new Date(current.token_expires_at)
          : null,
        metadata: { ...currentMeta, live_broadcast_id: undefined },
        connectedBy: current.connected_by ?? undefined,
      },
      supabase,
    );
  }

  return result;
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

export type SyndicationStatus = {
  status: "pending" | "success" | "failed";
  errorMessage: string | null;
  attemptedAt: string | null;
};

/**
 * Latest push result per platform for the church's most recent stream event.
 * Drives the "did it actually reach YouTube/Facebook?" indicator in the UI.
 */
export async function getLatestSyndicationStatus(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<Partial<Record<SyndicationPlatform, SyndicationStatus>>> {
  const client = supabase ?? createAdminClient();

  const { data: events } = await client
    .from("stream_events")
    .select("id")
    .eq("church_id", churchId)
    .order("starts_at", { ascending: false })
    .limit(1);

  const eventId = events?.[0]?.id as string | undefined;
  if (!eventId) return {};

  const { data: attempts } = await client
    .from("stream_syndication_attempts")
    .select("platform, status, error_message, attempted_at")
    .eq("stream_event_id", eventId)
    .order("attempted_at", { ascending: false });

  const result: Partial<Record<SyndicationPlatform, SyndicationStatus>> = {};

  for (const row of attempts ?? []) {
    const platform = row.platform as SyndicationPlatform;
    if (platform !== "youtube" && platform !== "facebook") continue;
    // Ordered newest-first, so the first row per platform wins.
    if (result[platform]) continue;
    result[platform] = {
      status: row.status as SyndicationStatus["status"],
      errorMessage: (row.error_message as string | null) ?? null,
      attemptedAt: (row.attempted_at as string | null) ?? null,
    };
  }

  return result;
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
      title: string | null;
      youtube_privacy: "public" | "unlisted" | "private" | null;
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

    // Only a platform with no destination at all is re-provisioned.
    //
    // The relay also reports `failed` when a push it had been given drops, and
    // acting on that here would mint a fresh YouTube broadcast in the middle of
    // a service — orphaning the one people are already watching. A destination
    // that exists is the relay's problem to reconnect to, not ours to replace.
    const settings = await getStreamRelaySettings(event.church_id, {
      supabase: client,
    });

    if (
      event.syndicate_youtube &&
      !settings.youtubeUrl &&
      lastYoutube?.status === "failed" &&
      shouldRetry(lastYoutube?.attempted_at)
    ) {
      try {
        await provisionYouTubeLiveForChurch(
          event.church_id,
          event.created_by,
          client,
          {
            title: event.title ?? undefined,
            privacyStatus: event.youtube_privacy ?? "public",
          },
        );
        await recordSyndicationAttempt(event.id, "youtube", "pending", undefined, client);
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
      !settings.facebookUrl &&
      lastFacebook?.status === "failed" &&
      shouldRetry(lastFacebook?.attempted_at)
    ) {
      try {
        await provisionFacebookLiveForChurch(
          event.church_id,
          event.created_by,
          client,
        );
        await recordSyndicationAttempt(event.id, "facebook", "pending", undefined, client);
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
  userId: string | null,
  supabase?: SupabaseClient,
) {
  await clearStreamRelayDestinations(churchId, userId, supabase);
}
