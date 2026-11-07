import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import {
  clearSimulatedPlayoutSource,
  listPendingSimulatedPlayoutJobs,
  retryPendingSimulatedPlayouts,
} from "@/lib/stream/simulated";

export async function GET(request: Request) {
  const provided = request.headers.get("x-stream-relay-secret");
  const expected = process.env.STREAM_RELAY_WEBHOOK_SECRET;

  if (!compareSecret(provided, expected)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const recovery = await retryPendingSimulatedPlayouts();
    const jobs = await listPendingSimulatedPlayoutJobs();
    return NextResponse.json({ ok: recovery.failed === 0, jobs, recovery }, {
      status: recovery.failed > 0 ? 503 : 200,
      headers: { "Cache-Control": "no-store" },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Simulated video handoff is unavailable." }, { status: 503 });
  }
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

  if (!body.eventId || !/^[0-9a-f-]{36}$/i.test(body.eventId)) {
    return NextResponse.json({ error: "Invalid event" }, { status: 400 });
  }
  try {
    await clearSimulatedPlayoutSource(body.eventId);
  } catch {
    return NextResponse.json({ ok: false, error: "Could not acknowledge simulated video handoff." }, { status: 503 });
  }

  return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
