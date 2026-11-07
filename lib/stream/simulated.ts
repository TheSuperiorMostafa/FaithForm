import { createAdminClient } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";
import { readAllById } from "@/lib/queries/paged-read";
import { STREAM_RECORDINGS_BUCKET } from "@/lib/stream/recording-storage";
import {
  buildCapabilityStreamName,
  MAX_INGEST_TTL_SEC,
  signIngestToken,
} from "@/lib/stream/ingest-token";
import { getStreamRelaySettings } from "@/lib/stream/relay";

const SIMULATED_BUCKET = STREAM_RECORDINGS_BUCKET;

export type SimulatedPlayoutJob = {
  eventId: string;
  churchId: string;
  sourceUrl: string;
  ingestUrl: string;
  streamName: string;
};

export type SimulatedPlayoutStart = {
  churchId: string;
  eventId: string;
  storagePath: string;
};

function missingHandoffTable(code?: string) {
  return code === "42P01" || code === "PGRST205";
}

async function queueSimulatedPlayout(input: SimulatedPlayoutStart, admin: SupabaseClient, legacy: boolean) {
  const { data, error: signingError } = await admin.storage
    .from(SIMULATED_BUCKET)
    .createSignedUrl(input.storagePath, 60 * 60 * 4);

  if (signingError || !data?.signedUrl) {
    throw new Error("Could not sign simulated video URL.");
  }

  if (legacy) {
    const { error } = await admin.from("stream_events")
      .update({ simulated_playout_url: data.signedUrl })
      .eq("id", input.eventId).eq("church_id", input.churchId);
    if (error) throw new Error("Could not save simulated video handoff.");
    return;
  }

  const { error } = await admin.from("stream_simulated_playout_handoffs").upsert({
    event_id: input.eventId,
    church_id: input.churchId,
    source_url: data.signedUrl,
    prepared_at: new Date().toISOString(),
  }, { onConflict: "event_id" });
  if (error) throw new Error("Could not save simulated video handoff.");
}

type Handoff = { source_url: string | null; prepared_at: string | null; completed_at: string | null };
type SimulatedEvent = {
  id: string; church_id: string; simulated_source_path: string;
  stream_session_id: string | null;
  stream_simulated_playout_handoffs: Handoff | Handoff[] | null;
};

class HandoffSchemaUnavailable extends Error {}

async function liveSimulatedEvents(admin: SupabaseClient): Promise<SimulatedEvent[] | null> {
  try {
    return await readAllById<SimulatedEvent>(async (afterId, includeCount, pageSize) => {
      let query = admin.from("stream_events")
        // The handoff has both event and tenant foreign keys. Select the event
        // relationship explicitly so PostgREST does not reject an ambiguous join.
        .select("id, church_id, simulated_source_path, stream_session_id, stream_simulated_playout_handoffs!stream_simulated_playout_handoffs_event_id_fkey(source_url,prepared_at,completed_at)", {
          count: includeCount ? "exact" : undefined,
        })
        .eq("status", "live").eq("simulated", true)
        .not("simulated_source_path", "is", null).order("id").limit(pageSize);
      if (afterId) query = query.gt("id", afterId);
      const result = await query;
      if (missingHandoffTable(result.error?.code) || result.error?.code === "PGRST200") {
        throw new HandoffSchemaUnavailable();
      }
      return { ...result, data: result.data as unknown as SimulatedEvent[] | null };
    }, { label: "simulated stream handoffs" });
  } catch (error) {
    if (error instanceof HandoffSchemaUnavailable) return null;
    throw error;
  }
}

function handoffFor(event: SimulatedEvent): Handoff | null {
  const handoff = event.stream_simulated_playout_handoffs;
  return Array.isArray(handoff) ? handoff[0] ?? null : handoff;
}

export async function retryPendingSimulatedPlayouts(
  client?: SupabaseClient,
  newlyStarted: readonly SimulatedPlayoutStart[] = [],
): Promise<{
  prepared: number; failed: number; deferred: number;
}> {
  const admin = client ?? createAdminClient();
  const result = { prepared: 0, failed: 0, deferred: 0 };
  const events = await liveSimulatedEvents(admin);
  if (events === null) {
    // Until the private handoff migration is present, use the existing queue.
    // Only newly started events are eligible because the old queue cannot
    // distinguish a missing handoff from a completed one.
    for (const event of newlyStarted) {
      try {
        await queueSimulatedPlayout(event, admin, true);
        result.prepared++;
      } catch {
        result.failed++;
      }
    }
    return result;
  }
  for (const event of events) {
    const handoff = handoffFor(event);
    if (handoff?.completed_at || handoff?.source_url) continue;
    try {
      // Retry only the handoff for this existing session. Never call Go Live
      // or provision platforms again to repair a signing/database failure.
      const { data: session, error } = await admin.from("stream_sessions")
        .select("id").eq("id", event.stream_session_id ?? "00000000-0000-0000-0000-000000000000")
        .eq("church_id", event.church_id).in("status", ["waiting_for_encoder", "live"])
        .maybeSingle();
      if (error) throw new Error("Simulated session read failed");
      if (!session) { result.deferred++; continue; }
      await queueSimulatedPlayout({
        churchId: event.church_id, eventId: event.id, storagePath: event.simulated_source_path,
      }, admin, false);
      result.prepared++;
    } catch {
      result.failed++;
    }
  }
  return result;
}

export async function listPendingSimulatedPlayoutJobs(client?: SupabaseClient): Promise<
  SimulatedPlayoutJob[]
> {
  const admin = client ?? createAdminClient();
  const events = await liveSimulatedEvents(admin);

  const jobs: SimulatedPlayoutJob[] = [];
  let ready: { id: string; church_id: string; sourceUrl: string | null }[];
  if (events === null) {
    const { data, error } = await admin.from("stream_events")
      .select("id, church_id, simulated_playout_url")
      .eq("status", "live").eq("simulated", true)
      .not("simulated_playout_url", "is", null).limit(10);
    if (error) throw new Error("Could not read simulated video handoffs.");
    ready = (data ?? []).map((event) => ({
      id: event.id, church_id: event.church_id, sourceUrl: event.simulated_playout_url,
    }));
  } else {
    ready = events.map((event) => {
      const handoff = handoffFor(event);
      return { id: event.id, church_id: event.church_id,
        sourceUrl: handoff?.completed_at ? null : handoff?.source_url ?? null };
    });
  }

  for (const event of ready) {
    if (!event.sourceUrl) continue;
    const churchId = event.church_id;
    const settings = await getStreamRelaySettings(churchId, {
      includeSecret: false,
      supabase: admin,
    });

    if (!settings.connected || !settings.ingestServerUrl) {
      continue;
    }

    jobs.push({
      eventId: event.id,
      churchId,
      sourceUrl: event.sourceUrl,
      ingestUrl: settings.ingestServerUrl,
      streamName: buildCapabilityStreamName(
        churchId,
        signIngestToken(churchId, { ttlSec: MAX_INGEST_TTL_SEC }),
      ),
    });
  }

  return jobs;
}

export async function clearSimulatedPlayoutSource(eventId: string, client?: SupabaseClient) {
  const admin = client ?? createAdminClient();
  const { data, error } = await admin
    .from("stream_simulated_playout_handoffs")
    .update({ source_url: null, completed_at: new Date().toISOString() })
    .eq("event_id", eventId).select("event_id").maybeSingle();
  if (missingHandoffTable(error?.code)) {
    const { error: legacyError } = await admin.from("stream_events")
      .update({ simulated_playout_url: null }).eq("id", eventId);
    if (legacyError) throw new Error("Could not acknowledge simulated video handoff.");
    return;
  }
  if (error || !data) throw new Error("Could not acknowledge simulated video handoff.");
}
