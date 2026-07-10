import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import { getStreamRelaySettings } from "@/lib/stream/relay";
import { createClient } from "@/lib/supabase/server";

function getWhipUpstreamBase(): string {
  return (
    process.env.STREAM_WHIP_UPSTREAM_URL?.trim() ||
    process.env.STREAM_HLS_UPSTREAM_URL?.trim()?.replace(/:8888\/?$/, ":8889") ||
    `http://${process.env.NEXT_PUBLIC_STREAM_RELAY_HOST ?? "stream.faithform.io"}:8889`
  ).replace(/\/$/, "");
}

export async function POST(request: Request) {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const settings = await getStreamRelaySettings(auth.churchId, {
    includeSecret: true,
    supabase,
  });

  if (!settings.streamPath) {
    return NextResponse.json({ error: "Stream not configured" }, { status: 400 });
  }

  const sdp = await request.text();
  const upstream = `${getWhipUpstreamBase()}/${settings.streamPath}/whip`;
  const basicAuth = Buffer.from(`:${settings.publishKey}`).toString("base64");

  let upstreamResponse: Response;
  try {
    upstreamResponse = await fetch(upstream, {
      method: "POST",
      headers: {
        "Content-Type": "application/sdp",
        Authorization: `Basic ${basicAuth}`,
      },
      body: sdp,
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach the stream relay for browser publish." },
      { status: 502 },
    );
  }

  const answer = await upstreamResponse.text();
  if (!upstreamResponse.ok) {
    return NextResponse.json(
      {
        error:
          answer.trim() ||
          `WHIP upstream failed (${upstreamResponse.status}). Check relay webhook secret.`,
      },
      { status: upstreamResponse.status },
    );
  }

  const headers = new Headers();
  headers.set("Content-Type", "application/sdp");

  const location = upstreamResponse.headers.get("Location");
  if (location) {
    headers.set("Location", location);
  }

  return new NextResponse(answer, {
    status: upstreamResponse.status,
    headers,
  });
}

export async function DELETE(request: Request) {
  const location = request.headers.get("Location");
  if (!location) {
    return NextResponse.json({ error: "Missing Location header" }, { status: 400 });
  }

  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  try {
    await fetch(location, { method: "DELETE" });
  } catch {
    return NextResponse.json({ error: "Could not stop browser publish." }, { status: 502 });
  }

  return NextResponse.json({ ok: true });
}
