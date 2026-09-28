import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import { featureAccessDenied } from "@/lib/features/guard";
import { getBrowserIceServers } from "@/lib/stream/ice-servers";
import { signIngestToken } from "@/lib/stream/ingest-token";
import { ensureStreamRelayCredentials, type StreamRelaySettings } from "@/lib/stream/relay";
import { createClient } from "@/lib/supabase/server";

function getWsIngestBaseUrl(): string | null {
  const raw = process.env.STREAM_WS_INGEST_UPSTREAM_URL?.trim() || null;

  if (!raw) return null;
  return raw.replace(/^http/i, "ws").replace(/\/$/, "");
}

/** Starting the studio provisions a new church before it asks the relay to ingest. */
export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const denied = await featureAccessDenied("live_stream", supabase);
  if (denied) return denied;

  let settings: StreamRelaySettings;
  try {
    settings = await ensureStreamRelayCredentials(auth.churchId, auth.userId, supabase);
  } catch {
    return NextResponse.json(
      { error: "Stream credentials could not be prepared." },
      { status: 503 },
    );
  }

  if (!settings.connected) {
    return NextResponse.json(
      { error: "Stream credentials are not configured." },
      { status: 400 },
    );
  }

  const wsBase = getWsIngestBaseUrl();
  const ingestToken = signIngestToken(auth.churchId);
  const wsIngestUrl = wsBase
    ? `${wsBase}/?token=${encodeURIComponent(ingestToken)}`
    : null;

  return NextResponse.json({
    method: wsIngestUrl ? "websocket" : "whip",
    wsIngestUrl,
    whipUrl: "/api/stream/whip",
    iceServers: getBrowserIceServers(),
  });
}
