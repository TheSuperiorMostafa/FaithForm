import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { getIntegrationStatus } from "@/lib/integrations/tokens";
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
  clearRelayDestinations,
  completeYouTubeBroadcast,
  getLatestSyndicationStatus,
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
  // Nullable so scheduled/cron starts with no acting user do not write an
  // invalid auth.users reference into created_by / started_by / connected_by.
  userId: string | null,
  options?: { title?: string; eventId?: string },
  supabase?: SupabaseClient,
) {
  const client = getClient(supabase);
  const integrationStatus = await getIntegrationStatus(churchId, client);
  const encoder = await getPrimaryEncoderDevice(churchId, client);

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
        syndicateYoutube: integrationStatus.youtube.connected,
        syndicateFacebook: integrationStatus.facebook.connected,
      },
      client,
    );
  }

  // A disconnected platform is a syndication problem, not a reason to block
  // the service. It gets recorded as a failed attempt below and picked up by
  // the retry job once the church reconnects.
  const syndicateYoutube =
    event.syndicateYoutube && integrationStatus.youtube.connected;
  const syndicateFacebook =
    event.syndicateFacebook && integrationStatus.facebook.connected;

  // Always start from a clean slate. Destinations persist on the church's
  // stream integration, so last week's RTMP URLs would otherwise still be in
  // the relay config — pushing this service to an ended broadcast, or to a
  // platform the operator has since turned off.
  await clearRelayDestinations(churchId, userId, client);

  const provisioned =
    syndicateYoutube || syndicateFacebook
      ? await provisionDestinationsForEvent(
          { ...event, syndicateYoutube, syndicateFacebook },
          userId,
          client,
        )
      : { destinations: [], errors: {} };

  const destinations = provisioned.destinations;

  if (event.syndicateYoutube) {
    const ok = destinations.some((d) => d.name === "youtube");
    await recordSyndicationAttempt(
      event.id,
      "youtube",
      ok ? "success" : "failed",
      ok
        ? undefined
        : (provisioned.errors.youtube ??
          "YouTube is not connected for this church."),
      client,
    );
  }
  if (event.syndicateFacebook) {
    const ok = destinations.some((d) => d.name === "facebook");
    await recordSyndicationAttempt(
      event.id,
      "facebook",
      ok ? "success" : "failed",
      ok
        ? undefined
        : (provisioned.errors.facebook ??
          "Facebook is not connected for this church."),
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

  // The session knows which event it belongs to, so end that one. Selecting any
  // `live` row and taking the first is how services ended up ending each other:
  // the query had no ordering, so with more than one row lingering it closed an
  // arbitrary older event and left the current one live forever — which then
  // lingered for the next service to close by mistake. Fall back to the newest
  // live event only for sessions predating stream_event_id.
  const eventColumns =
    "id, recurrence_rule, starts_at, title, syndicate_youtube, syndicate_facebook, youtube_privacy, chat_enabled, countdown_enabled, created_by";

  const { data: events } = session.streamEventId
    ? await client
        .from("stream_events")
        .select(eventColumns)
        // Still filtered on `live` so ending an already-ended service is inert
        // and cannot mint a second occurrence of a weekly event.
        .eq("id", session.streamEventId)
        .eq("status", "live")
        .limit(1)
    : await client
        .from("stream_events")
        .select(eventColumns)
        .eq("church_id", churchId)
        .eq("status", "live")
        .order("starts_at", { ascending: false })
        .limit(1);

  // Stop the relay pushing to broadcasts that are now over.
  await clearRelayDestinations(churchId, session.startedBy, client);

  // Then close the broadcast on YouTube's side. Isolated, because a platform
  // that will not shut down cleanly must not leave the local session stuck live.
  try {
    await completeYouTubeBroadcast(churchId, client);
  } catch (err) {
    console.error("endLiveBroadcast: completeYouTubeBroadcast", err);
  }

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
          createdBy: liveEvent.created_by ?? null,
        },
        client,
      );
    }
  }

  // A church has at most one broadcast at a time, so anything else still marked
  // live is debris — either from the bug above or from a service that ended
  // without going through here. Left behind it keeps surfacing as the church's
  // current event on the watch page long after the service is over.
  await client
    .from("stream_events")
    .update({ status: "ended" })
    .eq("church_id", churchId)
    .eq("status", "live");

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
  const [
    session,
    encoder,
    settings,
    integrationStatus,
    upcomingEvent,
    previewIngestActive,
    churchRow,
    syndication,
  ] = await Promise.all([
    getActiveStreamSession(churchId, client),
    getPrimaryEncoderDevice(churchId, client),
    getStreamRelaySettings(churchId, { supabase: client }),
    getIntegrationStatus(churchId, client),
    import("@/lib/stream/events").then((m) =>
      m.getUpcomingStreamEvent(churchId, client),
    ),
    isPreviewIngestActive(churchId, client),
    client.from("churches").select("slug").eq("id", churchId).maybeSingle(),
    getLatestSyndicationStatus(churchId, client),
  ]);

  const slug = (churchRow.data?.slug as string | undefined) ?? "";
  const shareLinks = await getStreamShareLinks(churchId, {
    slug,
    session,
    supabase: client,
  });

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
        ready: integrationStatus.youtube.connected,
        channelTitle: integrationStatus.youtube.channelTitle,
        // Destination the relay will actually push to this service.
        destinationReady: Boolean(settings.youtubeUrl),
        lastPush: syndication.youtube ?? null,
      },
      facebook: {
        connected: integrationStatus.facebook.connected,
        ready: integrationStatus.facebook.connected,
        pageName: integrationStatus.facebook.pageName,
        destinationReady: Boolean(settings.facebookUrl),
        lastPush: syndication.facebook ?? null,
      },
    },
  };
}
