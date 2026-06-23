import { NextResponse } from "next/server";
import { z } from "zod";
import { getChurchAuth } from "@/lib/auth/church";
import {
  MAX_HEARTBEAT_SECONDS,
  recordDashboardHeartbeat,
} from "@/lib/dashboard/usage";

const bodySchema = z.object({
  seconds: z.number().int().min(1).max(MAX_HEARTBEAT_SECONDS).optional(),
});

export async function POST(request: Request) {
  const auth = await getChurchAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let seconds = 30;
  try {
    const json = await request.json();
    const parsed = bodySchema.safeParse(json);
    if (parsed.success && parsed.data.seconds) {
      seconds = parsed.data.seconds;
    }
  } catch {
    // Empty body is fine — default interval applies.
  }

  await recordDashboardHeartbeat({
    userId: auth.userId,
    churchId: auth.churchId,
    seconds,
  });

  return NextResponse.json({ ok: true });
}
