import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export type StreamRecording = {
  id: string;
  churchId: string;
  streamSessionId: string | null;
  streamEventId: string | null;
  title: string | null;
  storagePath: string;
  durationSec: number | null;
  status: "processing" | "ready" | "published";
  trimStartSec: number;
  trimEndSec: number | null;
  publishedAt: string | null;
  createdAt: string;
};

type Row = {
  id: string;
  church_id: string;
  stream_session_id: string | null;
  stream_event_id: string | null;
  title: string | null;
  storage_path: string;
  duration_sec: number | null;
  status: "processing" | "ready" | "published";
  trim_start_sec: number;
  trim_end_sec: number | null;
  published_at: string | null;
  created_at: string;
};

function map(row: Row): StreamRecording {
  return {
    id: row.id,
    churchId: row.church_id,
    streamSessionId: row.stream_session_id,
    streamEventId: row.stream_event_id,
    title: row.title,
    storagePath: row.storage_path,
    durationSec: row.duration_sec,
    status: row.status,
    trimStartSec: row.trim_start_sec,
    trimEndSec: row.trim_end_sec,
    publishedAt: row.published_at,
    createdAt: row.created_at,
  };
}

function getClient(supabase?: SupabaseClient) {
  return supabase ?? createAdminClient();
}

export async function listStreamRecordings(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<StreamRecording[]> {
  const client = getClient(supabase);
  const { data, error } = await client
    .from("stream_recordings")
    .select("*")
    .eq("church_id", churchId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => map(row as Row));
}

export async function createStreamRecording(
  input: {
    churchId: string;
    streamSessionId?: string | null;
    streamEventId?: string | null;
    title?: string | null;
    storagePath: string;
    durationSec?: number | null;
  },
  supabase?: SupabaseClient,
): Promise<StreamRecording> {
  const client = getClient(supabase);
  const { data, error } = await client
    .from("stream_recordings")
    .insert({
      church_id: input.churchId,
      stream_session_id: input.streamSessionId ?? null,
      stream_event_id: input.streamEventId ?? null,
      title: input.title ?? null,
      storage_path: input.storagePath,
      duration_sec: input.durationSec ?? null,
      status: "processing",
    })
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Could not save recording.");
  return map(data as Row);
}

export async function getStreamRecording(
  recordingId: string,
  supabase?: SupabaseClient,
): Promise<StreamRecording | null> {
  const client = getClient(supabase);
  const { data, error } = await client
    .from("stream_recordings")
    .select("*")
    .eq("id", recordingId)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data ? map(data as Row) : null;
}

export async function getPublishedRecordingForChurch(
  churchId: string,
  recordingId: string,
  supabase?: SupabaseClient,
): Promise<StreamRecording | null> {
  const recording = await getStreamRecording(recordingId, supabase);
  if (!recording || recording.churchId !== churchId) return null;
  if (recording.status !== "published") return null;
  return recording;
}

export async function updateStreamRecording(
  recordingId: string,
  patch: Partial<{
    status: "processing" | "ready" | "published";
    trimStartSec: number;
    trimEndSec: number | null;
    title: string;
    publishedAt: string | null;
  }>,
  supabase?: SupabaseClient,
): Promise<StreamRecording> {
  const client = getClient(supabase);
  const updates: Record<string, unknown> = {};
  if (patch.status !== undefined) updates.status = patch.status;
  if (patch.trimStartSec !== undefined) updates.trim_start_sec = patch.trimStartSec;
  if (patch.trimEndSec !== undefined) updates.trim_end_sec = patch.trimEndSec;
  if (patch.title !== undefined) updates.title = patch.title;
  if (patch.publishedAt !== undefined) updates.published_at = patch.publishedAt;

  const { data, error } = await client
    .from("stream_recordings")
    .update(updates)
    .eq("id", recordingId)
    .select("*")
    .single();

  if (error || !data) throw new Error(error?.message ?? "Could not update recording.");
  return map(data as Row);
}
