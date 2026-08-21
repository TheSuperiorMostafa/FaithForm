import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import { featureAccessDenied } from "@/lib/features/guard";
import { signIngestToken } from "@/lib/stream/ingest-token";
import { getStreamRelaySettings } from "@/lib/stream/relay";
import { createClient } from "@/lib/supabase/server";
import { isAbortError, startStreamTimer } from "@/lib/stream/telemetry";

export const dynamic = "force-dynamic";

function getWhipUpstreamBase(): string {
  return (
    process.env.STREAM_WHIP_UPSTREAM_URL?.trim() ||
    process.env.STREAM_HLS_UPSTREAM_URL?.trim()?.replace(/:8888\/?$/, ":8889") ||
    `http://${process.env.NEXT_PUBLIC_STREAM_RELAY_HOST ?? "stream.faithform.io"}:8889`
  ).replace(/\/$/, "");
}

/**
 * The WHIP resource URL is supplied by the client on teardown and fetched
 * server-side, so it must be pinned to the configured relay origin. Without
 * this the DELETE handler is an authenticated SSRF into internal networks.
 */
function isAllowedResourceUrl(candidate: string): boolean {
  try {
    const base = new URL(getWhipUpstreamBase());
    const target = new URL(candidate, base);
    return (
      target.protocol === base.protocol &&
      target.hostname === base.hostname &&
      target.port === base.port
    );
  } catch {
    return false;
  }
}

export async function POST(request: Request) {
  const timer = startStreamTimer({ route: "stream/whip", method: "POST" });
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  timer.mark("auth");

  if (!auth?.isAdmin) {
    timer.end("error", { category: "auth", status: 403 });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const denied = await featureAccessDenied("live_stream", supabase);
  if (denied) {
    timer.end("error", { category: "auth", status: 403 });
    return denied;
  }

  const settings = await getStreamRelaySettings(auth.churchId, {
    includeSecret: false,
    includeInternalPath: true,
    supabase,
  });
  timer.mark("settings");

  if (!settings.streamPath) {
    timer.end("error", { category: "config", status: 400 });
    return NextResponse.json({ error: "Stream not configured" }, { status: 400 });
  }

  const sdp = await request.text();
  const capability = signIngestToken(auth.churchId);
  const upstream = `${getWhipUpstreamBase()}/${settings.streamPath}/whip?token=${encodeURIComponent(capability)}`;

  let upstreamResponse: Response;
  try {
    timer.mark("upstream_start");
    upstreamResponse = await fetch(upstream, {
      method: "POST",
      redirect: "manual",
      headers: {
        "Content-Type": "application/sdp",
      },
      body: sdp,
      // Stop negotiating the moment the broadcaster gives up on the request.
      signal: request.signal,
    });
    timer.mark("upstream_headers");
  } catch (error) {
    if (isAbortError(error) || request.signal.aborted) {
      timer.end("aborted", { category: "client_abort" });
      return new NextResponse(null, { status: 499 });
    }
    timer.end("error", { category: "upstream_unreachable", status: 502 });
    return NextResponse.json(
      { error: "Could not reach the stream relay for browser publish." },
      { status: 502 },
    );
  }

  const answer = await upstreamResponse.text();
  if (!upstreamResponse.ok) {
    timer.end("error", {
      category: "upstream_status",
      status: upstreamResponse.status,
    });
    return NextResponse.json(
      { error: "Browser publish negotiation failed." },
      { status: upstreamResponse.status },
    );
  }

  const headers = new Headers();
  headers.set("Content-Type", "application/sdp");
  headers.set("Cache-Control", "no-store");
  headers.set("X-Stream-Request-Id", timer.requestId);

  const location = upstreamResponse.headers.get("Location");
  if (location) {
    headers.set("Location", location);
    // fetch() cannot read Location unless it is explicitly exposed, and
    // teardown depends on the client having it.
    headers.set("Access-Control-Expose-Headers", "Location");
  }

  timer.end("ok", { status: upstreamResponse.status });

  return new NextResponse(answer, {
    status: upstreamResponse.status,
    headers,
  });
}

export async function DELETE(request: Request) {
  const timer = startStreamTimer({ route: "stream/whip", method: "DELETE" });
  const location = request.headers.get("Location");
  if (!location) {
    timer.end("error", { category: "bad_request", status: 400 });
    return NextResponse.json({ error: "Missing Location header" }, { status: 400 });
  }

  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  timer.mark("auth");

  if (!auth?.isAdmin) {
    timer.end("error", { category: "auth", status: 403 });
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const denied = await featureAccessDenied("live_stream", supabase);
  if (denied) {
    timer.end("error", { category: "auth", status: 403 });
    return denied;
  }

  if (!isAllowedResourceUrl(location)) {
    timer.end("error", { category: "bad_request", status: 400 });
    return NextResponse.json(
      { error: "Invalid WHIP resource location" },
      { status: 400 },
    );
  }

  try {
    const response = await fetch(new URL(location, getWhipUpstreamBase()), {
      method: "DELETE",
      redirect: "manual",
    });
    if (!response.ok) {
      timer.end("error", {
        category: "upstream_status",
        status: response.status,
      });
      return NextResponse.json(
        { error: "Could not stop browser publish." },
        { status: 502 },
      );
    }
  } catch {
    timer.end("error", { category: "upstream_unreachable", status: 502 });
    return NextResponse.json(
      { error: "Could not stop browser publish." },
      { status: 502 },
    );
  }

  timer.end("ok");
  return NextResponse.json({ ok: true });
}
