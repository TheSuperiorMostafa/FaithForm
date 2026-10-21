import type { SupabaseClient } from "@supabase/supabase-js";
import type { ArtworkCrop } from "@/lib/media/artwork";
import { updateStreamEvent } from "@/lib/stream/events";

/** Check before accepting an upload, without reading another church's service. */
export async function requireScheduledArtworkTarget(
  churchId: string,
  eventId: string,
  client: SupabaseClient,
): Promise<void> {
  const { data, error } = await client.from("stream_events")
    .select("id")
    .eq("id", eventId)
    .eq("church_id", churchId)
    .eq("status", "scheduled")
    .maybeSingle();
  if (error) throw new Error("We couldn't check that upcoming service. Please try again.");
  if (!data) throw new Error("Only an upcoming service in your church can be edited.");
}

/** The status condition also protects against a service going live mid-upload. */
export async function setScheduledArtwork(
  churchId: string,
  eventId: string,
  crop: ArtworkCrop,
  url: string | null,
  client: SupabaseClient,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const patch = crop === "poster"
    ? { artworkPosterUrl: url }
    : crop === "wide"
      ? { artworkWideUrl: url, artworkUrl: url }
      : { artworkBannerUrl: url };
  try {
    await updateStreamEvent(eventId, churchId, patch, client, "scheduled");
    return { ok: true };
  } catch {
    return { ok: false, error: "We couldn't save that artwork. Check that the service is still upcoming and try again." };
  }
}
