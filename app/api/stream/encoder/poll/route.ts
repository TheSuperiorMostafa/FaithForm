import { NextResponse } from "next/server";
import {
  completeStreamCommand,
  getEncoderDeviceBySecret,
  getPendingStreamCommand,
  touchEncoderDevice,
} from "@/lib/stream/encoder";
import { verifyStreamSecret } from "@/lib/stream/device-secret";
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
      includeSecret: true,
    });

    return NextResponse.json({
      command: pending.command,
      commandId: pending.id,
      payload: {
        ...pending.payload,
        ingestServerUrl:
          pending.payload.ingestServerUrl ?? settings.ingestServerUrl,
        streamKey: pending.payload.streamKey ?? settings.streamName,
        obsWebsocketHost: device.obs_websocket_host,
        obsWebsocketPort: device.obs_websocket_port,
        obsWebsocketPassword: device.obs_websocket_password,
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Poll failed";
    return NextResponse.json({ error: message }, { status: 500 });
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

    await completeStreamCommand(body.commandId, body.status, body.error);
    await touchEncoderDevice(device.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Ack failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
