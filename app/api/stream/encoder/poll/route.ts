import { NextResponse } from "next/server";
import {
  completeStreamCommand,
  getEncoderDeviceBySecret,
  getPendingStreamCommand,
  touchEncoderDevice,
} from "@/lib/stream/encoder";
import { verifyStreamSecret } from "@/lib/stream/device-secret";
import {
  buildCapabilityStreamName,
  MAX_INGEST_TTL_SEC,
  signIngestToken,
} from "@/lib/stream/ingest-token";
import { getStreamRelaySettings } from "@/lib/stream/relay";

function readDeviceSecret(request: Request): string | null {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    return auth.slice("Bearer ".length).trim();
  }
  return request.headers.get("x-faithform-device-secret")?.trim() ?? null;
}

export async function GET(request: Request) {
  const deviceSecret = readDeviceSecret(request);
  if (!deviceSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const device = await getEncoderDeviceBySecret(deviceSecret);
    if (!device || !verifyStreamSecret(deviceSecret, device.device_secret_hash)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await touchEncoderDevice(device.id);
    const pending = await getPendingStreamCommand(device.id);
    if (!pending) {
      return NextResponse.json({ command: null });
    }

    const settings = await getStreamRelaySettings(device.church_id, {
      includeSecret: false,
    });
    if (!settings.connected) {
      return NextResponse.json({ error: "Stream unavailable" }, { status: 503 });
    }

    const safePayload = { ...pending.payload };
    delete safePayload.streamKey;
    const streamKey =
      pending.command === "start_stream"
        ? buildCapabilityStreamName(
            device.church_id,
            signIngestToken(device.church_id, {
              ttlSec: MAX_INGEST_TTL_SEC,
            }),
          )
        : undefined;

    return NextResponse.json({
      command: pending.command,
      commandId: pending.id,
      payload: {
        ...safePayload,
        ingestServerUrl:
          pending.payload.ingestServerUrl ?? settings.ingestServerUrl,
        ...(streamKey ? { streamKey } : {}),
        obsWebsocketHost: device.obs_websocket_host,
        obsWebsocketPort: device.obs_websocket_port,
        obsWebsocketPassword: device.obs_websocket_password,
      },
    });
  } catch {
    return NextResponse.json({ error: "Poll failed" }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const deviceSecret = readDeviceSecret(request);
  if (!deviceSecret) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    commandId?: string;
    status?: "completed" | "failed";
    error?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.commandId || !body.status) {
    return NextResponse.json({ error: "commandId and status required" }, { status: 400 });
  }

  try {
    const device = await getEncoderDeviceBySecret(deviceSecret);
    if (!device || !verifyStreamSecret(deviceSecret, device.device_secret_hash)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    await completeStreamCommand(
      body.commandId,
      device.id,
      device.church_id,
      body.status,
      body.error?.slice(0, 500),
    );
    await touchEncoderDevice(device.id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Ack failed" }, { status: 500 });
  }
}
