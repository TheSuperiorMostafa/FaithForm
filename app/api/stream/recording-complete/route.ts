import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import { createStreamRecording } from "@/lib/stream/recordings";
import { parseStreamPath } from "@/lib/stream/relay";
import { getActiveStreamSession } from "@/lib/stream/sessions";

export async function POST(request: Request) {
  const providedSecret =
    request.headers.get("x-stream-relay-secret") ??
    new URL(request.url).searchParams.get("secret");
  const expectedSecret = process.env.STREAM_RELAY_WEBHOOK_SECRET;

  if (!compareSecret(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    path?: string;
    storagePath?: string;
    durationSec?: number;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseStreamPath(body.path ?? "");
  if (!parsed || !body.storagePath) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const session = await getActiveStreamSession(parsed.churchId);
  const recording = await createStreamRecording({
    churchId: parsed.churchId,
    streamSessionId: session?.id ?? null,
    storagePath: body.storagePath,
    durationSec: body.durationSec ?? null,
    title: session?.title ?? "Service recording",
  });

  return NextResponse.json({ ok: true, recordingId: recording.id });
}
