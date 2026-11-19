import { unstable_cache } from "next/cache";

import { isChurchFeatureEnabled } from "@/lib/features/access";
import { getChurchBySlug } from "@/lib/queries/giving";
import { isPubliclyLive, OFFLINE_SITE_LIVE_STATUS, type SiteLiveStatus } from "@/lib/sites/live-banner";
import { getPublicStreamEventByChurchId } from "@/lib/stream/events";
import { isPreviewIngestActive } from "@/lib/stream/preview-ingest";
import { getActiveStreamSession } from "@/lib/stream/sessions";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Seconds a status read is shared. Site pages render on every request and the
 * banner polls from every open tab, so the stream tables are hit at most once
 * per church per window rather than once per visitor.
 */
export const SITE_LIVE_STATUS_TTL_SECONDS = 15;

async function readSiteLiveStatus(churchId: string): Promise<SiteLiveStatus> {
  try {
    if (!(await isChurchFeatureEnabled(churchId, "live_stream"))) return OFFLINE_SITE_LIVE_STATUS;
    const admin = createAdminClient();
    const [event, session, previewIngestActive] = await Promise.all([
      getPublicStreamEventByChurchId(churchId, admin),
      getActiveStreamSession(churchId, admin),
      isPreviewIngestActive(churchId, admin),
    ]);
    const live = isPubliclyLive({
      sessionStatus: session?.status,
      ingestStartedAt: session?.ingestStartedAt,
      previewIngestActive,
      hasPublicEvent: Boolean(event),
    });
    // Only public fields leave this function: never keys, playback URLs or ids.
    return live ? { live: true, eventTitle: event?.title?.trim() || null } : OFFLINE_SITE_LIVE_STATUS;
  } catch (error) {
    // A stream outage must never take the church's website down with it.
    console.error("site live status:", error instanceof Error ? error.message : error);
    return OFFLINE_SITE_LIVE_STATUS;
  }
}

/**
 * Shares one read per key for the TTL. Outside a Next request (scripts, unit
 * tests rendering the page) there is no incremental cache; read directly.
 */
async function shared(read: () => Promise<SiteLiveStatus>, key: string[]): Promise<SiteLiveStatus> {
  let cached: () => Promise<SiteLiveStatus>;
  try {
    cached = unstable_cache(read, key, { revalidate: SITE_LIVE_STATUS_TTL_SECONDS });
  } catch {
    return read();
  }
  return cached().catch((error: unknown) => {
    if (error instanceof Error && error.message.includes("incrementalCache missing")) return read();
    throw error;
  });
}

/** Public live status for a church's website, cached for a few seconds. */
export function getSiteLiveStatus(churchId: string): Promise<SiteLiveStatus> {
  return shared(() => readSiteLiveStatus(churchId), ["site-live-status", churchId]);
}

/** Slug variant for the public polling endpoint. Unknown slugs read as offline. */
export function getSiteLiveStatusBySlug(slug: string): Promise<SiteLiveStatus> {
  return shared(async () => {
    const church = await getChurchBySlug(slug).catch(() => null);
    return church ? readSiteLiveStatus(church.churchId) : OFFLINE_SITE_LIVE_STATUS;
  }, ["site-live-status-slug", slug]);
}
