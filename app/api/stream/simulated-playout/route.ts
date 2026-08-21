import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import {
  clearSimulatedPlayoutSource,
  listPendingSimulatedPlayoutJobs,
} from "@/lib/stream/simulated";

export async function GET(request: Request) {
  const provided = request.headers.get("x-stream-relay-secret");
  const expected = process.env.STREAM_RELAY_WEBHOOK_SECRET;

  if (!compareSecret(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const jobs = await listPendingSimulatedPlayoutJobs();
  return NextResponse.json({ jobs });
}

export async function POST(request: Request) {
  const provided = request.headers.get("x-stream-relay-secret");
  const expected = process.env.STREAM_RELAY_WEBHOOK_SECRET;

  if (!compareSecret(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: { eventId?: string };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (body.eventId) {
    await clearSimulatedPlayoutSource(body.eventId);
  }

  return NextResponse.json({ ok: true });
}
