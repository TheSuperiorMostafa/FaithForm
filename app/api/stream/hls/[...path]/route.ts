import { NextRequest, NextResponse } from "next/server";
import { rewriteM3u8Playlist } from "@/lib/stream/hls-player";
import { verifyPlaybackToken } from "@/lib/stream/playback";
import { getStreamRelaySettings } from "@/lib/stream/relay";
import { isAbortError, startStreamTimer } from "@/lib/stream/telemetry";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const NO_STORE = "private, no-cache, no-store, must-revalidate";

function upstreamBase(): string {
  const value = process.env.STREAM_HLS_UPSTREAM_URL?.trim();
  if (!value) throw new Error("Stream playback is unavailable.");
  return value.replace(/\/$/, "");
}

function playbackAuthorization(): string | null {
  const secret = process.env.STREAM_RELAY_PLAYBACK_SECRET?.trim();
  if (!secret || secret.length < 32) return null;
  return `Basic ${Buffer.from(`faithform-playback:${secret}`).toString("base64")}`;
}

function contentTypeFor(path: string, upstreamType: string | null): string {
  if (upstreamType) return upstreamType;
  if (path.endsWith(".m3u8")) return "application/vnd.apple.mpegurl";
  if (path.endsWith(".ts")) return "video/mp2t";
  if (path.endsWith(".m4s") || path.endsWith(".mp4")) return "video/mp4";
  if (path.endsWith(".vtt")) return "text/vtt";
  return "application/octet-stream";
}

async function capabilityIsCurrentlyAuthorized(input: {
  churchId: string;
  eventId: string;
  audience: "public" | "staff";
}): Promise<boolean> {
  const admin = createAdminClient();
  const { data: event } = await admin
    .from("stream_events")
    .select("id")
    .eq("id", input.eventId)
    .eq("church_id", input.churchId)
    .eq("status", "live")
    .eq("public_access", input.audience === "public")
    .maybeSingle();

  if (!event && input.audience === "public") return false;

  // Staff capabilities may view either public or protected events, but the
  // event and active session still have to belong to the exact church.
  if (!event && input.audience === "staff") {
    const { data: staffEvent } = await admin
      .from("stream_events")
      .select("id")
      .eq("id", input.eventId)
      .eq("church_id", input.churchId)
      .eq("status", "live")
      .maybeSingle();
    if (!staffEvent) return false;
  }

  const { data: session } = await admin
    .from("stream_sessions")
    .select("id")
    .eq("church_id", input.churchId)
    .eq("stream_event_id", input.eventId)
    .in("status", ["preparing", "waiting_for_encoder", "live"])
    .limit(1)
    .maybeSingle();
  return Boolean(session?.id);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await params;
  const segments = path ?? [];
  const timer = startStreamTimer({
    route: "stream/hls",
    kind: segments.at(-1)?.endsWith(".m3u8") ? "playlist" : "segment",
    sampleRate: 0.01,
  });

  if (
    segments.length < 2 ||
    segments.some(
      (segment) =>
        !segment ||
        segment === "." ||
        segment === ".." ||
        segment.includes("\\") ||
        segment.includes(":"),
    )
  ) {
    timer.end("error", { category: "bad_request", status: 404 });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const churchId = segments[0];
  const token = request.nextUrl.searchParams.get("cap") ?? "";
  const capability = verifyPlaybackToken(token, { churchId });
  if (!capability) {
    timer.end("error", { category: "auth", status: 401 });
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!(await capabilityIsCurrentlyAuthorized(capability))) {
    timer.end("error", { category: "auth", status: 403 });
    return NextResponse.json({ error: "Unavailable" }, { status: 403 });
  }

  const settings = await getStreamRelaySettings(churchId, {
    includeSecret: false,
    includeInternalPath: true,
  });
  if (!settings.streamPath) {
    timer.end("error", { category: "config", status: 503 });
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }

  const mediaPath = segments.slice(1).map(encodeURIComponent).join("/");
  const upstreamPath = `${settings.streamPath}/${mediaPath}`;
  const isPlaylist = upstreamPath.endsWith(".m3u8");
  const authorization = playbackAuthorization();
  if (!authorization) {
    timer.end("error", { category: "config", status: 503 });
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }
  let upstream: Response;
  try {
    const range = request.headers.get("range");
    upstream = await fetch(`${upstreamBase()}/${upstreamPath}`, {
      cache: "no-store",
      redirect: "manual",
      signal: request.signal,
      headers: {
        Accept: request.headers.get("accept") ?? "*/*",
        Authorization: authorization,
        ...(range ? { Range: range } : {}),
      },
    });
  } catch (error) {
    if (isAbortError(error) || request.signal.aborted) {
      timer.end("aborted", { category: "client_abort" });
      return new NextResponse(null, { status: 499 });
    }
    timer.end("error", { category: "upstream_unreachable", status: 502 });
    return NextResponse.json({ error: "Playback unavailable" }, { status: 502 });
  }

  if (!upstream.ok) {
    timer.end("error", {
      category: "upstream_status",
      status: upstream.status,
    });
    return NextResponse.json(
      { error: "Playback unavailable" },
      {
        status: upstream.status >= 400 ? upstream.status : 502,
        headers: { "Cache-Control": NO_STORE },
      },
    );
  }

  const contentType = contentTypeFor(
    upstreamPath,
    upstream.headers.get("content-type"),
  );
  if (isPlaylist) {
    const playlist = await upstream.text();
    const rewritten = rewriteM3u8Playlist(
      playlist,
      request.nextUrl.pathname,
      `cap=${encodeURIComponent(token)}`,
    );
    timer.end("ok", { status: upstream.status, bytes: rewritten.length });
    return new NextResponse(rewritten, {
      status: upstream.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": NO_STORE,
        "Access-Control-Allow-Origin": "*",
        "X-Stream-Request-Id": timer.requestId,
      },
    });
  }

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": NO_STORE,
    "Access-Control-Allow-Origin": "*",
    "X-Stream-Request-Id": timer.requestId,
  });
  for (const header of ["content-length", "content-range", "accept-ranges"]) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }
  timer.end("ok", { status: upstream.status });
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
