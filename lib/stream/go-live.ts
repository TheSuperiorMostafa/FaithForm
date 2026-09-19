import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { endFacebookLiveVideo } from "@/lib/integrations/facebook-live";
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
import { getStreamShareLinks } from "@/lib/stream/share-links";
import { publishToFaithForm } from "@/lib/media/v1/publication";
import {
  ensureRecordingForSession,
  logRecordingEvent,
  onBroadcastEnded,
} from "@/lib/stream/recording-lifecycle";
import type { SessionWindow } from "@/lib/stream/recording-model";
import { productionLifecycleDeps } from "@/lib/stream/recording-runtime";
import { notifyServiceLive } from "@/lib/stream/recording-notifications";
import type { StreamSession } from "@/lib/stream/sessions";

function sessionWindow(session: StreamSession): SessionWindow {
  return {
    id: session.id,
    churchId: session.churchId,
    streamEventId: session.streamEventId,
    title: session.title,
    createdAt: session.createdAt,
    endedAt: session.endedAt,
    status: session.status,
  };
}

/**
 * Every FaithForm livestream is recorded. The recording row is created here,
 * at Go Live, so it carries the service's title, event and session from the
 * first second. Deliberately not fatal: if this write fails, the relay path
 * creates the same row (idempotently) the moment the first segment arrives,
 * and the Live screen will not claim "Recording" until a segment is actually
 * acknowledged.
 */
async function startRecordingFor(session: StreamSession): Promise<void> {
  try {
    await ensureRecordingForSession(productionLifecycleDeps(), sessionWindow(session));
  } catch (error) {
    logRecordingEvent("recording_create_deferred", {
      churchId: session.churchId,
      sessionId: session.id,
      error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
    });
  }
}

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

  // Provisioning only proves a destination exists. Whether video reaches the
  // platform is the relay's business, and it reports that back to
  // /api/stream/syndication/report — so a successful hand-off is `pending`
  // here, not `success`. Calling it success at this point is why the dashboard
  // showed both platforms green through services that never went out.
  if (event.syndicateYoutube) {
    const ok = destinations.some((d) => d.name === "youtube");
    await recordSyndicationAttempt(
      event.id,
      "youtube",
      ok ? "pending" : "failed",
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
      ok ? "pending" : "failed",
      ok
        ? undefined
        : (provisioned.errors.facebook ??
          "Facebook is not connected for this church."),
      client,
    );
  }

  const settings = await ensureStreamRelayCredentials(churchId, userId, client);

  if (!settings.connected) {
    throw new Error("Stream credentials are missing.");
  }

  // "Go live" is the congregation-facing action, not merely a relay switch.
  // Before this, a pastor could be on air successfully while both mobile apps
  // kept the service hidden until somebody found a separate publishing screen.
  // Scheduled starts keep their explicit publication choice; an admin-started
  // broadcast is published to everyone as part of the same intent.
  if (userId) {
    const publication = await publishToFaithForm(
      {
        churchId,
        kind: "live",
        id: event.id,
        visibility: "public",
        actorUserId: userId,
      },
      client,
    );
    if (!publication.ok) {
      throw new Error("Could not make this broadcast visible in FaithForm.");
    }
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

  await startRecordingFor(session);

  const previewActive = await isPreviewIngestActive(churchId, client);
  const now = new Date().toISOString();

  await updateStreamEvent(
    event.id,
    churchId,
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
        },
      },
      client,
    );
  }

  if (previewActive) {
    await transitionYouTubeBroadcastLive(churchId, client);
    const live = await updateStreamSession(
      session.id,
      {
        status: "live",
        ingestStartedAt: now,
        liveStartedAt: now,
      },
      client,
    );
    await notifyServiceLive({ churchId, eventId: event.id, sessionId: session.id }).catch(() => false);
    return live;
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
    "id, recurrence_rule, starts_at, title, syndicate_youtube, syndicate_facebook, youtube_privacy, chat_enabled, countdown_enabled, public_access, created_by";

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

  // Then close the broadcast on each platform. Isolated per platform, because
  // one that will not shut down cleanly must not leave the local session stuck
  // live — or stop the other from being closed.
  try {
    await completeYouTubeBroadcast(churchId, client);
  } catch (err) {
    console.error("endLiveBroadcast: completeYouTubeBroadcast", err);
  }

  try {
    await endFacebookLiveVideo(churchId, client);
  } catch (err) {
    console.error("endLiveBroadcast: endFacebookLiveVideo", err);
  }

  const liveEvent = events?.[0];
  if (liveEvent) {
    await updateStreamEvent(liveEvent.id, churchId, { status: "ended" }, client);

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
          publicAccess: liveEvent.public_access !== false,
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

  const ended = await markStreamEnded(churchId, null, client);

  // The recording keeps going without anyone watching: it moves to
  // "Preparing", and the relay's remaining uploads and the reconciler carry it
  // the rest of the way. Never fatal to ending the broadcast.
  if (ended) {
    try {
      await onBroadcastEnded(productionLifecycleDeps(), churchId, ended.id);
    } catch (error) {
      logRecordingEvent("stream_end_deferred", {
        churchId,
        sessionId: ended.id,
        error: error instanceof Error ? error.message.slice(0, 200) : "unknown",
      });
    }
  }
  return ended;
}

export async function onIngestStarted(churchId: string, supabase?: SupabaseClient) {
  const client = getClient(supabase);
  const session = await getActiveStreamSession(churchId, client);
  if (!session) return null;

  await transitionYouTubeBroadcastLive(churchId, client);
  const firstVideo = !session.ingestStartedAt;
  const updated = await updateStreamSession(
    session.id,
    {
      status: "live",
      ingestStartedAt: session.ingestStartedAt ?? new Date().toISOString(),
      liveStartedAt: session.liveStartedAt ?? new Date().toISOString(),
    },
    client,
  );
  // Members hear "live now" once video is actually arriving, not when a button
  // was pressed on an empty stream. Deduplicated per broadcast in the outbox.
  if (firstVideo && session.streamEventId) {
    logRecordingEvent("broadcast_went_live", { churchId, sessionId: session.id });
    await notifyServiceLive({
      churchId,
      eventId: session.streamEventId,
      sessionId: session.id,
    }).catch(() => false);
  }
  return updated;
}

export async function getLiveBroadcastStatus(
  churchId: string,
  supabase?: SupabaseClient,
) {
  const client = getClient(supabase);
  const [
    session,
    encoder,
    privateSettings,
    integrationStatus,
    upcomingEvent,
    previewIngestActive,
    churchRow,
    syndication,
  ] = await Promise.all([
    getActiveStreamSession(churchId, client),
    getPrimaryEncoderDevice(churchId, client),
    getStreamRelaySettings(churchId, {
      includeSecret: true,
      supabase: client,
    }),
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
    settings: {
      ...privateSettings,
      // Status is serialized to the browser. Destination URLs contain stream
      // keys, so expose readiness below without exposing either URL.
      youtubeUrl: "",
      facebookUrl: "",
    },
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
        destinationReady: Boolean(privateSettings.youtubeUrl),
        lastPush: syndication.youtube ?? null,
        needsReconnect: integrationStatus.youtube.needsReconnect,
        reconnectReason: integrationStatus.youtube.reconnectReason,
      },
      facebook: {
        connected: integrationStatus.facebook.connected,
        ready: integrationStatus.facebook.connected,
        pageName: integrationStatus.facebook.pageName,
        destinationReady: Boolean(privateSettings.facebookUrl),
        lastPush: syndication.facebook ?? null,
        needsReconnect: integrationStatus.facebook.needsReconnect,
        reconnectReason: integrationStatus.facebook.reconnectReason,
      },
    },
  };
}
