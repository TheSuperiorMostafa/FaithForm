import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import { verifyIngestToken } from "@/lib/stream/ingest-token";
import { getStreamRelaySettings } from "@/lib/stream/relay";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const relaySecret = request.headers.get("x-stream-relay-secret");
  if (!compareSecret(relaySecret, process.env.STREAM_RELAY_WEBHOOK_SECRET)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let token: string | undefined;
  try {
    token = ((await request.json()) as { token?: string }).token;
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const capability = token ? verifyIngestToken(token) : null;
  if (!capability) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const settings = await getStreamRelaySettings(capability.churchId, {
    includeSecret: false,
    includeInternalPath: true,
  });
  if (!settings.streamName) {
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }

  return NextResponse.json(
    { streamName: settings.streamName },
    { headers: { "Cache-Control": "no-store" } },
  );
}
