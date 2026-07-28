import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type StreamSessionStatus =
  | "preparing"
  | "waiting_for_encoder"
  | "live"
  | "ended"
  | "error";

export type StreamSession = {
  id: string;
  churchId: string;
  status: StreamSessionStatus;
  title: string | null;
  startedBy: string | null;
  encoderDeviceId: string | null;
  streamEventId: string | null;
  destinationsSnapshot: Array<{ name: string; url: string }>;
  errorMessage: string | null;
  ingestStartedAt: string | null;
  liveStartedAt: string | null;
  endedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type SessionRow = {
  id: string;
  church_id: string;
  status: StreamSessionStatus;
  title: string | null;
  started_by: string | null;
  encoder_device_id: string | null;
  stream_event_id: string | null;
  destinations_snapshot: Array<{ name: string; url: string }> | null;
  error_message: string | null;
  ingest_started_at: string | null;
  live_started_at: string | null;
  ended_at: string | null;
  created_at: string;
  updated_at: string;
};

function mapSession(row: SessionRow): StreamSession {
  return {
    id: row.id,
    churchId: row.church_id,
    status: row.status,
    title: row.title,
    startedBy: row.started_by,
    encoderDeviceId: row.encoder_device_id,
    streamEventId: row.stream_event_id ?? null,
    destinationsSnapshot: row.destinations_snapshot ?? [],
    errorMessage: row.error_message,
    ingestStartedAt: row.ingest_started_at,
    liveStartedAt: row.live_started_at,
    endedAt: row.ended_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getClient(supabase?: SupabaseClient) {
  return supabase ?? createAdminClient();
}

export async function getActiveStreamSession(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<StreamSession | null> {
  const client = getClient(supabase);
  const { data, error } = await client
    .from("stream_sessions")
    .select("*")
    .eq("church_id", churchId)
    .in("status", ["preparing", "waiting_for_encoder", "live"])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data ? mapSession(data as SessionRow) : null;
}

export async function createStreamSession(
  input: {
    churchId: string;
    title?: string | null;
    startedBy: string | null;
    encoderDeviceId?: string | null;
    streamEventId?: string | null;
    destinationsSnapshot?: Array<{ name: string; url: string }>;
  },
  supabase?: SupabaseClient,
): Promise<StreamSession> {
  const client = getClient(supabase);
  const active = await getActiveStreamSession(input.churchId, client);
  if (active) {
    throw new Error("A broadcast is already in progress.");
  }

  const { data, error } = await client
    .from("stream_sessions")
    .insert({
      church_id: input.churchId,
      status: "preparing",
      title: input.title?.trim() || null,
      started_by: input.startedBy,
      encoder_device_id: input.encoderDeviceId ?? null,
      stream_event_id: input.streamEventId ?? null,
      destinations_snapshot: input.destinationsSnapshot ?? [],
    })
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create stream session.");
  }

  return mapSession(data as SessionRow);
}

export async function updateStreamSession(
  sessionId: string,
  patch: Partial<{
    status: StreamSessionStatus;
    destinationsSnapshot: Array<{ name: string; url: string }>;
    errorMessage: string | null;
    ingestStartedAt: string | null;
    liveStartedAt: string | null;
    endedAt: string | null;
  }>,
  supabase?: SupabaseClient,
): Promise<StreamSession> {
  const client = getClient(supabase);
  const updates: Record<string, unknown> = {};
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.destinationsSnapshot !== undefined) {
    updates.destinations_snapshot = patch.destinationsSnapshot;
  }
  if (patch.errorMessage !== undefined) updates.error_message = patch.errorMessage;
  if (patch.ingestStartedAt !== undefined) {
    updates.ingest_started_at = patch.ingestStartedAt;
  }
  if (patch.liveStartedAt !== undefined) updates.live_started_at = patch.liveStartedAt;
  if (patch.endedAt !== undefined) updates.ended_at = patch.endedAt;

  const { data, error } = await client
    .from("stream_sessions")
    .update(updates)
    .eq("id", sessionId)
    .select("*")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not update stream session.");
  }

  return mapSession(data as SessionRow);
}

export async function markStreamIngestStarted(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<StreamSession | null> {
  const session = await getActiveStreamSession(churchId, supabase);
  if (!session) return null;

  const now = new Date().toISOString();
  return updateStreamSession(
    session.id,
    {
      status: "live",
      ingestStartedAt: session.ingestStartedAt ?? now,
      liveStartedAt: session.liveStartedAt ?? now,
    },
    supabase,
  );
}

export async function markStreamEnded(
  churchId: string,
  errorMessage?: string | null,
  supabase?: SupabaseClient,
): Promise<StreamSession | null> {
  const session = await getActiveStreamSession(churchId, supabase);
  if (!session) return null;

  return updateStreamSession(
    session.id,
    {
      status: errorMessage ? "error" : "ended",
      errorMessage: errorMessage ?? null,
      endedAt: new Date().toISOString(),
    },
    supabase,
  );
}
