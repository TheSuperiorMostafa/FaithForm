import { NextResponse } from "next/server";
import { registerEncoderDevice } from "@/lib/stream/encoder";

export async function POST(request: Request) {
  let body: {
    pairingCode?: string;
    label?: string;
    encoderType?: "obs" | "atem" | "other";
    obsWebsocketHost?: string;
    obsWebsocketPort?: number;
    obsWebsocketPassword?: string;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!body.pairingCode?.trim()) {
    return NextResponse.json({ error: "pairingCode is required" }, { status: 400 });
  }

  try {
    const result = await registerEncoderDevice({
      pairingCode: body.pairingCode,
      label: body.label,
      encoderType: body.encoderType,
      obsWebsocketHost: body.obsWebsocketHost,
      obsWebsocketPort: body.obsWebsocketPort,
      obsWebsocketPassword: body.obsWebsocketPassword,
    });

    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Encoder registration failed";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
