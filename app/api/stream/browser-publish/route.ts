import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import { featureAccessDenied } from "@/lib/features/guard";
import { getBrowserIceServers } from "@/lib/stream/ice-servers";
import { signIngestToken } from "@/lib/stream/ingest-token";
import { getStreamRelaySettings } from "@/lib/stream/relay";
import { createClient } from "@/lib/supabase/server";

function getWsIngestBaseUrl(): string | null {
  const raw = process.env.STREAM_WS_INGEST_UPSTREAM_URL?.trim() || null;

  if (!raw) return null;
  return raw.replace(/^http/i, "ws").replace(/\/$/, "");
}

export async function GET() {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const denied = await featureAccessDenied("live_stream", supabase);
  if (denied) return denied;

  const settings = await getStreamRelaySettings(auth.churchId, {
    includeSecret: true,
    supabase,
  });

  if (!settings.streamPath) {
    return NextResponse.json(
      { error: "Stream credentials are not configured." },
      { status: 400 },
    );
  }

  if (!settings.publishKey) {
    return NextResponse.json(
      { error: "Stream credentials are not configured." },
      { status: 400 },
    );
  }

  const wsBase = getWsIngestBaseUrl();
  const ingestToken = signIngestToken(auth.churchId, settings.publishKey);
  const wsIngestUrl = wsBase
    ? `${wsBase}/?token=${encodeURIComponent(ingestToken)}`
    : null;

  return NextResponse.json({
    method: wsIngestUrl ? "websocket" : "whip",
    wsIngestUrl,
    whipUrl: "/api/stream/whip",
    iceServers: getBrowserIceServers(),
    streamPath: settings.streamPath,
  });
}
