import { NextResponse } from "next/server";
import { z } from "zod";
import { registerEncoderDevice } from "@/lib/stream/encoder";
import {
  assertRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

const bodySchema = z.object({
  pairingCode: z.string().regex(/^\d{6}$/),
  label: z.string().trim().min(1).max(80).optional(),
  encoderType: z.enum(["obs", "atem", "other"]).optional(),
  obsWebsocketHost: z.string().trim().min(1).max(255).optional(),
  obsWebsocketPort: z.number().int().min(1).max(65535).optional(),
  obsWebsocketPassword: z.string().max(512).optional(),
});

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") ?? 0) > 4096) {
    return NextResponse.json({ error: "Invalid request" }, { status: 413 });
  }

  const rate = await assertRateLimit(
    `encoder-register:${getClientIp(request)}`,
    { limit: 10, windowMs: 15 * 60 * 1000 },
  );
  if (!rate.ok) return rateLimitResponse(rate.retryAfterSeconds);

  let parsed: ReturnType<typeof bodySchema.safeParse>;
  try {
    parsed = bodySchema.safeParse(await request.json());
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  try {
    const result = await registerEncoderDevice(parsed.data);
    return NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json(
      { error: "Invalid or expired pairing code" },
      { status: 400 },
    );
  }
}
