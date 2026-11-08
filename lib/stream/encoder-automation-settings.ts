import { randomUUID } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";

export async function getEncoderAutoGoLive(churchId: string, client = createAdminClient()): Promise<boolean> {
  const { data, error } = await client
    .from("stream_encoder_automation")
    .select("enabled")
    .eq("church_id", churchId)
    .maybeSingle();

  if (error) throw error;
  return data?.enabled === true;
}

export async function saveEncoderAutoGoLive(
  churchId: string,
  enabled: boolean,
  client: SupabaseClient,
) {
  await withBroadcastOperation(churchId, client, async () => {
    const { error } = await client.from("stream_encoder_automation")
      .update({ enabled })
      .eq("church_id", churchId);
    if (error) throw error;
  });
}

/**
 * Serialize the platform side effects of dashboard, scheduled, and relay
 * starts/stops. A crashed invocation releases its lease by expiry.
 */
export async function withBroadcastOperation<T>(
  churchId: string,
  client: SupabaseClient,
  operation: () => Promise<T>,
): Promise<T> {
  const table = () => client.from("stream_encoder_automation");
  const { error: insertError } = await table().upsert(
    { church_id: churchId },
    { onConflict: "church_id", ignoreDuplicates: true },
  );
  if (insertError) throw insertError;

  const id = randomUUID();
  const now = new Date();
  const { data, error } = await table()
    .update({
      operation_id: id,
      operation_expires_at: new Date(now.getTime() + 10 * 60_000).toISOString(),
    })
    .eq("church_id", churchId)
    .or(`operation_expires_at.is.null,operation_expires_at.lt.${now.toISOString()}`)
    .select("church_id")
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error("A broadcast update is already in progress.");

  try {
    return await operation();
  } finally {
    const { error: releaseError } = await table()
      .update({ operation_id: null, operation_expires_at: null })
      .eq("church_id", churchId)
      .eq("operation_id", id);
    if (releaseError) console.error("Could not release broadcast operation", releaseError.code);
  }
}
