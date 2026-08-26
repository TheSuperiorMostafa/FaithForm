import { NextRequest, NextResponse } from "next/server";

import { rewriteM3u8Playlist } from "@/lib/stream/hls-player";
import {
  contentTypeFor,
  fetchFromRelay,
  relayCacheHeader,
  segmentsAreSafe,
} from "@/lib/stream/relay-upstream";
import {
  capabilityFromRequest,
  verifyMediaCapability,
} from "@/lib/media/v1/playback-capability";
import { authorizeDelivery } from "@/lib/media/v1/media-service";

export const dynamic = "force-dynamic";

/**
 * Live HLS for the Faithful apps.
 *
 * ## Why this exists beside `/api/stream/hls`
 *
 * The website's route authenticates with `?cap=` and rewrites that capability
 * onto every segment URL, because an `hls.js` player in a browser cannot attach
 * a header to the segment requests it makes on its own. That is a reasonable
 * trade for a page whose capability is not account-scoped.
 *
 * A native player can. `AVAssetResourceLoaderDelegate` on iOS and
 * `DefaultHttpDataSource.setDefaultRequestProperties` on Android both attach a
 * header to *every* request, playlist and segment alike. So Faithful's
 * capability never enters a URL — not the playlist's, not a segment's, not a
 * screenshot's, and not a proxy log's.
 *
 * Both routes reach the relay through the same `lib/stream/relay-upstream`
 * module. The relay's Basic credential is assembled there, server-side, and
 * appears in no response. Prompt 2's protection is unchanged: this route adds a
 * second *front door*, not a second way to reach the relay.
 *
 * ## Path shape
 *
 *     /api/media/v1/live/<churchSlug>/<eventId>/<...media>
 *
 * The church is a slug rather than an id because the capability names a slug,
 * and comparing the two is the tenant check.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path?: string[] }> },
) {
  const { path } = await params;
  const segments = path ?? [];

  // slug + eventId + at least one media segment.
  if (segments.length < 3 || !segmentsAreSafe(segments)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [churchSlug, eventId, ...mediaSegments] = segments;

  const verified = verifyMediaCapability(capabilityFromRequest(request), {
    churchSlug,
    kind: "live",
    mediaId: eventId,
  });
  if (!verified.ok) {
    // Malformed, forged, expired, or minted for another account, church or
    // item. One status for all of them; the client refreshes and retries.
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": relayCacheHeader() } },
    );
  }

  // **Re-checked on every request, not just at issuance.** A signature cannot
  // be revoked; this is what makes an unpublish or a revocation stop a stream
  // that is already playing, within one segment.
  const authorized = await authorizeDelivery({
    accountId: verified.capability.a,
    churchSlug,
    kind: "live",
    mediaId: eventId,
  });
  if (!authorized) {
    return NextResponse.json(
      { error: "Unavailable" },
      { status: 403, headers: { "Cache-Control": relayCacheHeader() } },
    );
  }

  const upstream = await fetchFromRelay({
    churchId: authorized.churchId,
    mediaSegments,
    accept: request.headers.get("accept"),
    range: request.headers.get("range"),
    signal: request.signal,
  });

  if (!upstream.ok) {
    if (upstream.reason === "aborted") return new NextResponse(null, { status: 499 });
    return NextResponse.json(
      { error: "Playback unavailable" },
      { status: upstream.reason === "unreachable" ? 502 : 503 },
    );
  }

  const response = upstream.response;
  if (!response.ok) {
    // The relay's own status is passed through as a class, never its body: an
    // upstream error page can name a path, a host, or a credential.
    return NextResponse.json(
      { error: "Playback unavailable" },
      {
        status: response.status >= 400 ? response.status : 502,
        headers: { "Cache-Control": relayCacheHeader() },
      },
    );
  }

  const contentType = contentTypeFor(upstream.upstreamPath, response.headers.get("content-type"));

  if (upstream.upstreamPath.endsWith(".m3u8")) {
    const playlist = await response.text();
    // **No query suffix.** The website's route passes `cap=…` here so its
    // browser player can fetch segments; passing anything would put Faithful's
    // capability into every segment URL, which is precisely what the header
    // strategy exists to avoid.
    const rewritten = rewriteM3u8Playlist(playlist, request.nextUrl.pathname);
    return new NextResponse(rewritten, {
      status: response.status,
      headers: {
        "Content-Type": contentType,
        "Cache-Control": relayCacheHeader(),
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "no-referrer",
      },
    });
  }

  const headers = new Headers({
    "Content-Type": contentType,
    "Cache-Control": relayCacheHeader(),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
  });
  for (const header of ["content-length", "content-range", "accept-ranges"]) {
    const value = response.headers.get(header);
    if (value) headers.set(header, value);
  }

  return new NextResponse(response.body, { status: response.status, headers });
}
