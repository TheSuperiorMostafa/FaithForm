import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  generateDeviceSecret,
  generatePairingCode,
  hashStreamSecret,
} from "@/lib/stream/device-secret";

export type EncoderDevice = {
  id: string;
  churchId: string;
  label: string;
  encoderType: "obs" | "atem" | "other";
  obsWebsocketHost: string;
  obsWebsocketPort: number;
  lastSeenAt: string | null;
  pairedAt: string | null;
  isPaired: boolean;
};

type DeviceRow = {
  id: string;
  church_id: string;
  label: string;
  encoder_type: "obs" | "atem" | "other";
  device_secret_hash: string | null;
  obs_websocket_host: string;
  obs_websocket_port: number;
  obs_websocket_password: string | null;
  last_seen_at: string | null;
  paired_at: string | null;
  paired_by?: string | null;
};

function mapDevice(row: DeviceRow): EncoderDevice {
  return {
    id: row.id,
    churchId: row.church_id,
    label: row.label,
    encoderType: row.encoder_type,
    obsWebsocketHost: row.obs_websocket_host,
    obsWebsocketPort: row.obs_websocket_port,
    lastSeenAt: row.last_seen_at,
    pairedAt: row.paired_at,
    isPaired: Boolean(row.device_secret_hash),
  };
}

function getClient(supabase?: SupabaseClient) {
  return supabase ?? createAdminClient();
}

export async function listEncoderDevices(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<EncoderDevice[]> {
  const client = getClient(supabase);
  const { data, error } = await client
    .from("encoder_devices")
    .select(
      "id, church_id, label, encoder_type, device_secret_hash, obs_websocket_host, obs_websocket_port, last_seen_at, paired_at",
    )
    .eq("church_id", churchId)
    .order("created_at", { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? []).map((row) => mapDevice(row as DeviceRow));
}

export async function createEncoderPairingCode(
  churchId: string,
  userId: string,
  supabase?: SupabaseClient,
): Promise<{ deviceId: string; pairingCode: string; expiresAt: string }> {
  const client = getClient(supabase);
  const pairingCode = generatePairingCode();
  const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();

  const { data, error } = await client
    .from("encoder_devices")
    .insert({
      church_id: churchId,
      label: "Streaming PC",
      encoder_type: "obs",
      pairing_code_hash: hashStreamSecret(pairingCode),
      pairing_expires_at: expiresAt,
      paired_by: userId,
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not create pairing code.");
  }

  return {
    deviceId: data.id,
    pairingCode,
    expiresAt,
  };
}

export async function registerEncoderDevice(
  input: {
    pairingCode: string;
    label?: string;
    encoderType?: "obs" | "atem" | "other";
    obsWebsocketHost?: string;
    obsWebsocketPort?: number;
    obsWebsocketPassword?: string;
  },
  supabase?: SupabaseClient,
): Promise<{
  deviceId: string;
  deviceSecret: string;
  ingestServerUrl: string;
}> {
  const client = getClient(supabase);
  const pairingHash = hashStreamSecret(input.pairingCode.trim());

  const { data: device, error } = await client
    .from("encoder_devices")
    .select("*")
    .eq("pairing_code_hash", pairingHash)
    .is("device_secret_hash", null)
    .gt("pairing_expires_at", new Date().toISOString())
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }
  if (!device) {
    throw new Error("Invalid or expired pairing code.");
  }

  const deviceSecret = generateDeviceSecret();
  const { data: claimed, error: updateError } = await client
    .from("encoder_devices")
    .update({
      label: input.label?.trim() || device.label,
      encoder_type: input.encoderType ?? device.encoder_type,
      obs_websocket_host: input.obsWebsocketHost ?? device.obs_websocket_host,
      obs_websocket_port: input.obsWebsocketPort ?? device.obs_websocket_port,
      obs_websocket_password:
        input.obsWebsocketPassword ?? device.obs_websocket_password,
      device_secret_hash: hashStreamSecret(deviceSecret),
      pairing_code_hash: null,
      pairing_expires_at: null,
      paired_at: new Date().toISOString(),
    })
    .eq("id", device.id)
    .eq("pairing_code_hash", pairingHash)
    .is("device_secret_hash", null)
    .select("id")
    .maybeSingle();

  if (updateError || !claimed?.id) {
    throw new Error("Invalid or expired pairing code.");
  }

  const { getStreamRelaySettings, ensureStreamRelayCredentials } = await import(
    "@/lib/stream/relay"
  );

  let settings = await getStreamRelaySettings(device.church_id, {
    includeSecret: false,
    supabase: client,
  });

  if (!settings.connected && device.paired_by) {
    settings = await ensureStreamRelayCredentials(
      device.church_id,
      device.paired_by,
      client,
    );
  }

  if (!settings.connected) {
    throw new Error("Stream credentials are not configured for this church.");
  }

  return {
    deviceId: device.id,
    deviceSecret,
    ingestServerUrl: settings.ingestServerUrl,
  };
}

export async function getEncoderDeviceBySecret(
  deviceSecret: string,
  supabase?: SupabaseClient,
) {
  const client = getClient(supabase);
  const secretHash = hashStreamSecret(deviceSecret);
  const { data, error } = await client
    .from("encoder_devices")
    .select("*")
    .eq("device_secret_hash", secretHash)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as DeviceRow | null;
}

export async function touchEncoderDevice(
  deviceId: string,
  supabase?: SupabaseClient,
) {
  const client = getClient(supabase);
  await client
    .from("encoder_devices")
    .update({ last_seen_at: new Date().toISOString() })
    .eq("id", deviceId);
}

export async function queueStreamCommand(
  input: {
    churchId: string;
    encoderDeviceId: string;
    command: "start_stream" | "stop_stream";
    payload?: Record<string, unknown>;
  },
  supabase?: SupabaseClient,
) {
  const client = getClient(supabase);
  const { data, error } = await client
    .from("stream_commands")
    .insert({
      church_id: input.churchId,
      encoder_device_id: input.encoderDeviceId,
      command: input.command,
      payload: input.payload ?? {},
    })
    .select("id")
    .single();

  if (error || !data) {
    throw new Error(error?.message ?? "Could not queue stream command.");
  }

  return data.id as string;
}

export async function getPendingStreamCommand(
  encoderDeviceId: string,
  supabase?: SupabaseClient,
) {
  const client = getClient(supabase);
  const { data, error } = await client
    .from("stream_commands")
    .select("*")
    .eq("encoder_device_id", encoderDeviceId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return data as
    | {
        id: string;
        command: "start_stream" | "stop_stream";
        payload: Record<string, unknown>;
      }
    | null;
}

export async function completeStreamCommand(
  commandId: string,
  encoderDeviceId: string,
  churchId: string,
  status: "completed" | "failed",
  errorMessage?: string,
  supabase?: SupabaseClient,
) {
  const client = getClient(supabase);
  await client
    .from("stream_commands")
    .update({
      status,
      error_message: errorMessage ?? null,
      completed_at: new Date().toISOString(),
    })
    .eq("id", commandId)
    .eq("encoder_device_id", encoderDeviceId)
    .eq("church_id", churchId)
    .eq("status", "pending");
}

export async function getPrimaryEncoderDevice(
  churchId: string,
  supabase?: SupabaseClient,
): Promise<EncoderDevice | null> {
  const devices = await listEncoderDevices(churchId, supabase);
  return devices.find((device) => device.isPaired) ?? null;
}
