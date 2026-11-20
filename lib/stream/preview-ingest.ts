import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClientOrNull } from "@/lib/supabase/admin";
import { getIntegration } from "@/lib/integrations/tokens";

/**
 * Records that an encoder is (or is no longer) publishing.
 *
 * Written as a compare-and-set rather than a plain read-modify-write. This lands
 * every 30s while a service is on air, and it shares one jsonb blob with the
 * church's RTMP destinations — so an update that overwrote the whole document
 * could quietly restore a copy taken before Go Live wrote them, and the service
 * would go out to an empty destination list. Losing a heartbeat to a lost race
 * is harmless; the next one is 30s away.
 */
export async function setPreviewIngestActive(
  churchId: string,
  active: boolean,
  _supabase?: SupabaseClient,
) {
  const client = createAdminClientOrNull();
  if (!client) return;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const { data, error } = await client
      .from("church_integrations")
      .select("metadata, updated_at")
      .eq("church_id", churchId)
      .eq("provider", "stream")
      .maybeSingle();

    if (error || !data) return;

    const metadata = (data.metadata ?? {}) as Record<string, unknown>;

    const { data: updated } = await client
      .from("church_integrations")
      .update({
        metadata: {
          ...metadata,
          preview_ingest_active: active,
          // Dropped from the document when inactive — `undefined` does not
          // survive serialization, which is the intent.
          preview_ingest_at: active ? new Date().toISOString() : undefined,
          // When the streaming software stopped. A live service ends once this
          // is older than the reconnect grace (see `lib/stream/video-stop.ts`).
          preview_ingest_stopped_at: active ? undefined : new Date().toISOString(),
        },
      })
      .eq("church_id", churchId)
      .eq("provider", "stream")
      .eq("updated_at", data.updated_at)
      .select("id");

    if (updated?.length) return;
  }
}

/**
 * How long a heartbeat stays good for.
 *
 * The relay re-sends `publish` every 30s while an encoder is publishing, so
 * anything older than this means the relay stopped, crashed, or lost the app —
 * in every case nothing is reaching the ingest. Without this the flag was
 * write-once: a single publish latched it true and nothing ever cleared it, so
 * every later Go Live believed a feed was already running, skipped starting the
 * paired encoder, and reported the session live while YouTube sat waiting.
 */
const HEARTBEAT_TTL_MS = 90_000;

export type PreviewIngestEvidence = {
  /** An encoder is publishing right now (a heartbeat inside the TTL). */
  active: boolean;
  /** The newest publish heartbeat, while the relay still reports publishing. */
  lastBeatAt: string | null;
  /** When the relay last reported that the encoder stopped publishing. */
  stoppedAt: string | null;
};

export async function getPreviewIngestEvidence(
  churchId: string,
  supabase?: SupabaseClient,
  now = Date.now(),
): Promise<PreviewIngestEvidence> {
  const integration = await getIntegration(churchId, "stream", supabase);
  if (!integration) return { active: false, lastBeatAt: null, stoppedAt: null };

  const metadata = (integration.metadata ?? {}) as {
    preview_ingest_active?: boolean;
    preview_ingest_at?: string;
    preview_ingest_stopped_at?: string;
  };

  const lastBeatAt = metadata.preview_ingest_active ? (metadata.preview_ingest_at ?? null) : null;
  const beatAt = lastBeatAt ? Date.parse(lastBeatAt) : NaN;
  return {
    active: !Number.isNaN(beatAt) && now - beatAt < HEARTBEAT_TTL_MS,
    lastBeatAt: Number.isNaN(beatAt) ? null : lastBeatAt,
    stoppedAt: metadata.preview_ingest_stopped_at ?? null,
  };
}

export async function isPreviewIngestActive(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<boolean> {
  return (await getPreviewIngestEvidence(churchId, supabase)).active;
}
