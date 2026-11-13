import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";

import { createAdminClient } from "@/lib/supabase/admin";
import { withBroadcastOperation } from "@/lib/stream/encoder-automation-settings";
import { getStreamEvent, getStreamEventNearEncoderStart } from "@/lib/stream/events";
import { endLiveBroadcastLocked, onIngestStarted, startLiveBroadcastLocked } from "@/lib/stream/go-live";
import { isPreviewIngestActive } from "@/lib/stream/preview-ingest";
import { getActiveStreamSession, updateStreamSession } from "@/lib/stream/sessions";

const DISCONNECT_GRACE_MS = 60_000;
const HEARTBEAT_TIMEOUT_MS = 120_000;
const sourceIdSchema = z.string().uuid().refine((id) => id !== "00000000-0000-0000-0000-000000000000");

export const encoderSignalSchema = z.object({
  path: z.string().regex(/^live\/[0-9a-f-]{36}$/i),
  event: z.enum(["publish", "unpublish"]),
  sourceId: sourceIdSchema,
}).strict();

/**
 * MediaMTX gives publish auth and the ready hook the same connection ID.
 * Remember the authorized candidate without changing the source on air.
 */
export async function authorizeEncoderSource(churchId: string, id: unknown) {
  const source = sourceIdSchema.safeParse(id);
  if (!source.success) return;

  const client = createAdminClient();
  // Keep the authenticated connection even while the pastor checks video
  // privately. Enabling automation later must work on its next heartbeat,
  // without requiring an otherwise unexplained OBS/ATEM restart.
  // Ignore conflicts so this cannot reset an existing enabled setting.
  const { error: insertError } = await client
    .from("stream_encoder_automation")
    .upsert({ church_id: churchId }, { onConflict: "church_id", ignoreDuplicates: true });
  if (insertError) throw insertError;

  const { data, error } = await client
    .from("stream_encoder_automation")
    .update({ authorized_source_id: source.data, authorized_at: new Date().toISOString() })
    .eq("church_id", churchId)
    .select("church_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("Could not register encoder source.");
}

async function readState(churchId: string, client: SupabaseClient) {
  const { data, error } = await client
    .from("stream_encoder_automation")
    .select("enabled, authorized_source_id, authorized_at, source_id, source_stopped, session_id, stop_after")
    .eq("church_id", churchId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function updateState(churchId: string, client: SupabaseClient, patch: Record<string, unknown>) {
  const { error } = await client.from("stream_encoder_automation").update(patch).eq("church_id", churchId);
  if (error) throw error;
}

export async function handleEncoderSignal(churchId: string, body: z.infer<typeof encoderSignalSchema>) {
  const client = createAdminClient();
  const existing = await readState(churchId, client);
  if (!existing || (body.sourceId !== existing.authorized_source_id && body.sourceId !== existing.source_id)) return;

  await withBroadcastOperation(churchId, client, async () => {
    const state = await readState(churchId, client);
    if (!state) return;
    const currentSource = body.sourceId === state.source_id;
    if (!currentSource && body.sourceId !== state.authorized_source_id) return;

    if (body.event === "unpublish") {
      // A stop delivered before its first ready callback retires that source
      // without detaching another encoder which is still on air.
      if (!currentSource && state.source_id) {
        await client.from("stream_encoder_automation")
          .update({ authorized_source_id: null, authorized_at: null })
          .eq("church_id", churchId)
          .eq("authorized_source_id", body.sourceId)
          .throwOnError();
        return;
      }
      if (state.source_stopped && currentSource) return;
      await updateState(churchId, client, {
        source_id: body.sourceId,
        source_stopped: true,
        stop_after: state.session_id ? new Date(Date.now() + DISCONNECT_GRACE_MS).toISOString() : null,
      });
      return;
    }

    if (currentSource && state.source_stopped) return;

    let session = await getActiveStreamSession(churchId, client);
    if (session) {
      const event = session.streamEventId ? await getStreamEvent(session.streamEventId, client) : null;
      if (event?.simulated) return;
      if (!state.enabled && session.id !== state.session_id) return;

      // A preparing row seen under this lease belongs to an interrupted start.
      // Its event link tells us whether setup completed before the interruption.
      if (session.status === "preparing") {
        if (event?.status === "live" && event.streamSessionId === session.id) {
          session = await updateStreamSession(session.id, { status: "waiting_for_encoder" }, client);
        }
        // Keep an uncertain provider start claimed. Ending the encoder feed
        // lets reconciliation close it without minting another broadcast.
      }
    }
    if (!session) {
      // The same connection cannot restart a service after an admin ends it.
      if (!state.enabled || (currentSource && state.session_id)) return;
      const { data: feature, error } = await client.from("church_features")
        .select("enabled")
        .eq("church_id", churchId)
        .eq("feature_key", "live_stream")
        .maybeSingle();
      if (error) throw error;
      if (feature?.enabled === false) return;
      const event = await getStreamEventNearEncoderStart(churchId, client);
      session = await startLiveBroadcastLocked(churchId, null, {
        eventId: event?.id,
        encoderIngestReady: true,
      }, client);
    }

    await updateState(churchId, client, {
      source_id: body.sourceId,
      source_stopped: false,
      session_id: session.id,
      stop_after: new Date(Date.now() + HEARTBEAT_TIMEOUT_MS).toISOString(),
    });
    if (session.status === "waiting_for_encoder") await onIngestStarted(churchId, client);
  });
}

export async function endDisconnectedEncoderBroadcasts(client = createAdminClient()) {
  const { data, error } = await client.from("stream_encoder_automation")
    .select("church_id")
    .not("session_id", "is", null)
    .lte("stop_after", new Date().toISOString())
    .order("stop_after")
    .limit(20);
  if (error) throw error;

  for (const { church_id: churchId } of data ?? []) {
    try {
      await withBroadcastOperation(churchId, client, async () => {
        const state = await readState(churchId, client);
        if (!state?.session_id || !state.stop_after || Date.parse(state.stop_after) > Date.now()) return;

        // Give an encoder that just reauthenticated time to send a ready signal.
        if (state.authorized_source_id !== state.source_id && state.authorized_at &&
            Date.now() - Date.parse(state.authorized_at) < DISCONNECT_GRACE_MS) return;

        const session = await getActiveStreamSession(churchId, client);
        if (session?.id === state.session_id) {
          // The existing relay heartbeat is independent of the signed callbacks.
          // Keep the service on air while the relay still sees a video source.
          if (await isPreviewIngestActive(churchId, client)) return;
          await endLiveBroadcastLocked(churchId, client, { stopPairedEncoder: false });
        }
        await updateState(churchId, client, { stop_after: null, source_stopped: true });
      });
    } catch (error) {
      console.error("Could not reconcile encoder disconnect", churchId, error);
    }
  }
}

