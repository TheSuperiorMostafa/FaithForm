import { NextResponse } from "next/server";
import { getChurchBySlug } from "@/lib/queries/giving";
import { getPublicStreamEventByChurchId } from "@/lib/stream/events";
import { isPreviewIngestActive } from "@/lib/stream/preview-ingest";
import { getActiveStreamSession } from "@/lib/stream/sessions";
import { getHlsPlaybackUrl } from "@/lib/stream/playback";
import { createAdminClient } from "@/lib/supabase/admin";

export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug")?.trim();
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const church = await getChurchBySlug(slug);
  if (!church) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminClient();
  const [event, session, previewIngestActive] = await Promise.all([
    getPublicStreamEventByChurchId(church.churchId, admin),
    getActiveStreamSession(church.churchId, admin),
    isPreviewIngestActive(church.churchId, admin),
  ]);

  const hasIngest =
    previewIngestActive || Boolean(session?.ingestStartedAt);

  let playerStatus: "countdown" | "offline" | "live" | "ended" = "offline";
  if (
    session &&
    hasIngest &&
    (session.status === "live" ||
      session.status === "waiting_for_encoder" ||
      session.status === "preparing")
  ) {
    playerStatus = "live";
  } else if (event?.status === "ended") {
    playerStatus = "ended";
  } else if (
    event?.status === "scheduled" &&
    event.countdownEnabled &&
    new Date(event.startsAt).getTime() > Date.now()
  ) {
    playerStatus = "countdown";
  }

  const playbackUrl =
    playerStatus === "live" && hasIngest
      ? event?.id
        ? getHlsPlaybackUrl({
            churchId: church.churchId,
            eventId: event.id,
            audience: "public",
          })
        : null
      : null;

  return NextResponse.json({
    churchName: church.churchName,
    slug: church.slug,
    eventTitle: event?.title ?? null,
    startsAt: event?.startsAt ?? null,
    countdownEnabled: event?.countdownEnabled ?? false,
    chatEnabled: event?.chatEnabled ?? false,
    status: playerStatus,
    playbackUrl,
    logoUrl: church.logoUrl ?? null,
    givingColor: church.givingPrimaryColor ?? null,
    streamEventId: event?.id ?? null,
  }, { headers: { "Cache-Control": "no-store" } });
}
