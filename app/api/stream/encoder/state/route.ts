import { NextResponse } from "next/server";
import { z } from "zod";
import { getEncoderDeviceBySecret, touchEncoderDevice } from "@/lib/stream/encoder";
import { verifyStreamSecret } from "@/lib/stream/device-secret";
import { getActiveStreamSession } from "@/lib/stream/sessions";
import { endLiveBroadcast } from "@/lib/stream/go-live";

const stateSchema = z.object({ event: z.literal("stopped"), sessionId: z.string().uuid() }).strict();

/** A deliberate OBS Stop ends the paired broadcast without waiting for cron. */
export async function POST(request: Request) {
  const auth = request.headers.get("authorization");
  const secret = auth?.startsWith("Bearer ") ? auth.slice(7).trim() : null;
  if (!secret) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = stateSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "Invalid state" }, { status: 400 });

  try {
    const device = await getEncoderDeviceBySecret(secret);
    if (!device || !verifyStreamSecret(secret, device.device_secret_hash)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    await touchEncoderDevice(device.id);
    const active = await getActiveStreamSession(device.church_id);
    // An event delayed by a network retry cannot end the following service,
    // and one church's paired device cannot stop another church's stream.
    if (active?.id === body.data.sessionId && active.encoderDeviceId === device.id) {
      await endLiveBroadcast(device.church_id, undefined, { expectedSessionId: active.id });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "State update failed" }, { status: 503 });
  }
}
