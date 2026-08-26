import { NextRequest, NextResponse } from "next/server";
import { rewriteM3u8Playlist } from "@/lib/stream/hls-player";
import { verifyPlaybackToken } from "@/lib/stream/playback";
import {
  contentTypeFor,
  fetchFromRelay,
  relayCacheHeader,
  segmentsAreSafe,
} from "@/lib/stream/relay-upstream";
import { startStreamTimer } from "@/lib/stream/telemetry";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The website's HLS front door. Unchanged in behaviour.
 *
 * Prompt 9 moved the *upstream* half — the relay base, the server-side Basic
 * credential, the path derivation and the segment validation — into
 * `lib/stream/relay-upstream`, so this route and Faithful's header-authenticated
 * `/api/media/v1/live` reach the relay through one contract rather than two
 * copies that could drift apart.
 *
 * What did not move, and must not: this route's own authentication. A browser
 * player carries its capability in the query string because it cannot attach a
 * header to the segment requests it issues; a native player can, and does.
 */

export const dynamic = "force-dynamic";
const NO_STORE = relayCacheHeader();

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

  if (segments.length < 2 || !segmentsAreSafe(segments)) {
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

  const relay = await fetchFromRelay({
    churchId,
    mediaSegments: segments.slice(1),
    accept: request.headers.get("accept"),
    range: request.headers.get("range"),
    signal: request.signal,
  });

  if (!relay.ok) {
    if (relay.reason === "aborted") {
      timer.end("aborted", { category: "client_abort" });
      return new NextResponse(null, { status: 499 });
    }
    if (relay.reason === "unreachable") {
      timer.end("error", { category: "upstream_unreachable", status: 502 });
      return NextResponse.json({ error: "Playback unavailable" }, { status: 502 });
    }
    timer.end("error", { category: "config", status: 503 });
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
  }

  const upstream = relay.response;
  const upstreamPath = relay.upstreamPath;
  const isPlaylist = upstreamPath.endsWith(".m3u8");

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
