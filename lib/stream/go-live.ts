import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getIntegration, getIntegrationStatus } from "@/lib/integrations/tokens";
import {
  getPrimaryEncoderDevice,
  queueStreamCommand,
} from "@/lib/stream/encoder";
import { getStreamRelaySettings, ensureStreamRelayCredentials } from "@/lib/stream/relay";
import {
  createStreamSession,
  getActiveStreamSession,
  updateStreamSession,
  markStreamEnded,
} from "@/lib/stream/sessions";
import {
  createStreamEvent,
  getStreamEvent,
  updateStreamEvent,
  nextWeeklyOccurrence,
  type StreamEvent,
} from "@/lib/stream/events";
import {
  provisionDestinationsForEvent,
  recordSyndicationAttempt,
  syndicationRetryUntil,
  transitionYouTubeBroadcastLive,
} from "@/lib/stream/syndication";
import { isPreviewIngestActive } from "@/lib/stream/preview-ingest";
import { getStreamShareLinks, type StreamShareLinks } from "@/lib/stream/share-links";

function getClient(supabase?: SupabaseClient) {
  return supabase ?? createAdminClient();
}

export async function startLiveBroadcast(
  churchId: string,
  userId: string,
  options?: { title?: string; eventId?: string },
  supabase?: SupabaseClient,
) {
  const client = getClient(supabase);
  const [integrationStatus, youtubeIntegration, facebookIntegration] = await Promise.all([
    getIntegrationStatus(churchId, client),
    getIntegration(churchId, "youtube", client),
    getIntegration(churchId, "facebook", client),
  ]);
  const encoder = await getPrimaryEncoderDevice(churchId, client);
  const youtubeConnected = Boolean(youtubeIntegration?.access_token);
  const facebookConnected = Boolean(facebookIntegration?.access_token);

  let event: StreamEvent | null = null;
  if (options?.eventId) {
    event = await getStreamEvent(options.eventId, client);
    if (!event || event.churchId !== churchId) {
      throw new Error("Stream event not found.");
    }
  } else {
    event = await createStreamEvent(
      {
        churchId,
        title: options?.title?.trim() || "Live Service",
        startsAt: new Date().toISOString(),
        createdBy: userId,
        syndicateYoutube: youtubeConnected,
        syndicateFacebook: facebookConnected,
      },
      client,
    );
  }

  const shouldSyndicateYoutube = event.syndicateYoutube || (!options?.eventId && youtubeConnected);
  const shouldSyndicateFacebook =
    event.syndicateFacebook || (!options?.eventId && facebookConnected);

  if (shouldSyndicateYoutube && !youtubeConnected) {
    throw new Error("YouTube syndication is enabled but YouTube is not connected.");
  }
  if (shouldSyndicateFacebook && !facebookConnected) {
    throw new Error(
      "Facebook syndication is enabled but Facebook is not connected.",
    );
  }

  const destinations =
    shouldSyndicateYoutube || shouldSyndicateFacebook
      ? await provisionDestinationsForEvent(
          {
            ...event,
            syndicateYoutube: shouldSyndicateYoutube,
            syndicateFacebook: shouldSyndicateFacebook,
          },
          userId,
          client,
        )
      : [];

  if (shouldSyndicateYoutube) {
    await recordSyndicationAttempt(
      event.id,
      "youtube",
      destinations.some((d) => d.name === "youtube") ? "success" : "failed",
      destinations.some((d) => d.name === "youtube")
        ? undefined
        : "YouTube provision failed",
      client,
    );
  }
  if (shouldSyndicateFacebook) {
    await recordSyndicationAttempt(
      event.id,
      "facebook",
      destinations.some((d) => d.name === "facebook") ? "success" : "failed",
      destinations.some((d) => d.name === "facebook")
        ? undefined
        : "Facebook provision failed",
      client,
    );
  }

  const settings = await ensureStreamRelayCredentials(churchId, userId, client);

  if (!settings.streamName) {
    throw new Error("Stream credentials are missing.");
  }

  const session = await createStreamSession(
    {
      churchId,
      title: event.title,
      startedBy: userId,
      encoderDeviceId: encoder?.id ?? null,
      streamEventId: event.id,
      destinationsSnapshot: destinations,
    },
    client,
  );

  const previewActive = await isPreviewIngestActive(churchId, client);
  const now = new Date().toISOString();

  await updateStreamEvent(
    event.id,
    {
      status: "live",
      streamSessionId: session.id,
      syndicationRetryUntil: syndicationRetryUntil(),
    },
    client,
  );

  if (encoder && !previewActive) {
    await queueStreamCommand(
      {
        churchId,
        encoderDeviceId: encoder.id,
        command: "start_stream",
        payload: {
          sessionId: session.id,
          eventId: event.id,
          ingestServerUrl: settings.ingestServerUrl,
          streamKey: settings.streamName,
        },
      },
      client,
    );
  }

  if (previewActive) {
    await transitionYouTubeBroadcastLive(churchId, client);
    return updateStreamSession(
      session.id,
      {
        status: "live",
        ingestStartedAt: now,
        liveStartedAt: now,
      },
      client,
    );
  }

  return updateStreamSession(
    session.id,
    { status: "waiting_for_encoder" },
    client,
  );
}

export async function endLiveBroadcast(
  churchId: string,
  supabase?: SupabaseClient,
) {
  const client = getClient(supabase);
  const session = await getActiveStreamSession(churchId, client);
  if (!session) {
    throw new Error("No active broadcast to end.");
  }

  const encoder = await getPrimaryEncoderDevice(churchId, client);
  if (encoder) {
    await queueStreamCommand(
      {
        churchId,
        encoderDeviceId: encoder.id,
        command: "stop_stream",
        payload: { sessionId: session.id },
      },
      client,
    );
  }

  const { data: events } = await client
    .from("stream_events")
    .select("id, recurrence_rule, starts_at, title, syndicate_youtube, syndicate_facebook, youtube_privacy, chat_enabled, countdown_enabled, created_by")
    .eq("church_id", churchId)
    .eq("status", "live")
    .limit(1);

  const liveEvent = events?.[0];
  if (liveEvent) {
    await updateStreamEvent(liveEvent.id, { status: "ended" }, client);

    const nextStarts = nextWeeklyOccurrence(
      liveEvent.starts_at,
      liveEvent.recurrence_rule,
    );
    if (nextStarts && liveEvent.recurrence_rule === "weekly") {
      await createStreamEvent(
        {
          churchId,
          title: liveEvent.title,
          startsAt: nextStarts,
          recurrenceRule: "weekly",
          syndicateYoutube: liveEvent.syndicate_youtube,
          syndicateFacebook: liveEvent.syndicate_facebook,
          youtubePrivacy: liveEvent.youtube_privacy,
          chatEnabled: liveEvent.chat_enabled,
          countdownEnabled: liveEvent.countdown_enabled,
          createdBy: liveEvent.created_by ?? churchId,
        },
        client,
      );
    }
  }

  return markStreamEnded(churchId, null, client);
}

export async function onIngestStarted(churchId: string, supabase?: SupabaseClient) {
  const client = getClient(supabase);
  const session = await getActiveStreamSession(churchId, client);
  if (!session) return null;

  await transitionYouTubeBroadcastLive(churchId, client);
  return updateStreamSession(
    session.id,
    {
      status: "live",
      ingestStartedAt: session.ingestStartedAt ?? new Date().toISOString(),
      liveStartedAt: session.liveStartedAt ?? new Date().toISOString(),
    },
    client,
  );
}

export async function getLiveBroadcastStatus(
  churchId: string,
  supabase?: SupabaseClient,
) {
  const client = getClient(supabase);
  const [session, encoder, settings, integrationStatus, youtubeInteg, upcomingEvent, previewIngestActive, churchRow] =
    await Promise.all([
      getActiveStreamSession(churchId, client),
      getPrimaryEncoderDevice(churchId, client),
      getStreamRelaySettings(churchId, { supabase: client }),
      getIntegrationStatus(churchId, client),
      getIntegration(churchId, "youtube", client),
      import("@/lib/stream/events").then((m) =>
        m.getUpcomingStreamEvent(churchId, client),
      ),
      isPreviewIngestActive(churchId, client),
      client.from("churches").select("slug").eq("id", churchId).maybeSingle(),
    ]);

  const slug = (churchRow.data?.slug as string | undefined) ?? "";
  const shareLinks = await getStreamShareLinks(churchId, {
    slug,
    session,
    supabase: client,
  });

  const ytMeta = (youtubeInteg?.metadata ?? {}) as import("@/lib/integrations/types").YouTubeIntegrationMetadata;

  return {
    session,
    encoder,
    settings,
    upcomingEvent,
    previewIngestActive,
    shareLinks,
    slug,
    platforms: {
      youtube: {
        connected: integrationStatus.youtube.connected,
        ready: integrationStatus.youtube.connected && ytMeta.live_streaming_enabled !== false,
        channelTitle: integrationStatus.youtube.channelTitle,
        liveStreamingError: ytMeta.live_streaming_error ?? null,
      },
      facebook: {
        connected: integrationStatus.facebook.connected,
        ready: integrationStatus.facebook.connected,
        pageName: integrationStatus.facebook.pageName,
      },
    },
  };
}
