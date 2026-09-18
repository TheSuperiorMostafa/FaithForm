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
  isMediaDeliveryToken,
  verifyMediaCapability,
  verifyMediaDeliveryToken,
} from "@/lib/media/v1/playback-capability";
import { authorizeDelivery } from "@/lib/media/v1/media-service";

export const dynamic = "force-dynamic";

/**
 * Live HLS for the FaithForm apps.
 *
 * ## Why this exists beside `/api/stream/hls`
 *
 * The website's route authenticates with `?cap=` and rewrites that capability
 * onto every segment URL, because an `hls.js` player in a browser cannot attach
 * a header to the segment requests it makes on its own. Its capability is not
 * account-scoped.
 *
 * FaithForm's is, and a native HLS player cannot attach a header to segment
 * requests either: AVFoundation refuses segments served through a resource
 * loader (-12881). So the apps are handed a **delivery path**:
 *
 *     /api/media/v1/live/<churchSlug>/<eventId>/<deliveryToken>/<...media>
 *
 * The playlist is rewritten under that same path, so every playlist and
 * segment URL the player derives carries the token and stays byte-identical
 * across playlist reloads, as HLS requires. The account capability itself
 * never enters a URL; see `playback-capability.ts` for why the delivery token
 * is a separate, domain-separated credential.
 *
 * The header form — the same path without a token, with the capability as a
 * bearer header — is still accepted, so a build that fetches with a header
 * keeps working.
 *
 * Both routes reach the relay through the same `lib/stream/relay-upstream`
 * module. The relay's Basic credential is assembled there, server-side, and
 * appears in no response. Prompt 2's protection is unchanged: this route adds a
 * second *front door*, not a second way to reach the relay.
 *
 * The church is a slug rather than an id because both credentials name a slug,
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

  const [churchSlug, eventId, ...rest] = segments;
  const credential = readCredential(request, { churchSlug, eventId, rest });
  if (!credential) {
    // Malformed, forged, expired, or minted for another account, church or
    // item. One status for all of them; the client asks for a new grant.
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": relayCacheHeader() } },
    );
  }
  const { mediaSegments } = credential;
  if (mediaSegments.length === 0) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  // **Re-checked on every request, not just at issuance.** A signature cannot
  // be revoked; this is what makes an unpublish or a revocation stop a stream
  // that is already playing, within one segment.
  const authorized = await authorizeDelivery({
    accountId: credential.accountId,
    churchSlug,
    kind: "live",
    mediaId: eventId,
    authorizationVersion: credential.authorizationVersion,
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
    // **No query suffix.** Every URI is rewritten under this request's own
    // path, so a delivery path hands its token on to the playlists and
    // segments below it, and a header-authenticated path hands on nothing.
    // Root-relative, so they resolve against whichever origin served this.
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

/**
 * Who is asking, from a delivery path or from a bearer header.
 *
 * A path segment shaped like a delivery token is **only** ever read as one: a
 * forged or expired token is refused here rather than falling through to the
 * header, so the two forms cannot be combined into a third.
 */
function readCredential(
  request: NextRequest,
  input: { churchSlug: string; eventId: string; rest: string[] },
): { accountId: string; authorizationVersion?: number; mediaSegments: string[] } | null {
  const expected = { churchSlug: input.churchSlug, kind: "live" as const, mediaId: input.eventId };

  if (isMediaDeliveryToken(input.rest[0])) {
    const verified = verifyMediaDeliveryToken(input.rest[0], expected);
    if (!verified.ok) return null;
    return {
      accountId: verified.capability.a,
      authorizationVersion: verified.capability.av,
      mediaSegments: input.rest.slice(1),
    };
  }

  const verified = verifyMediaCapability(capabilityFromRequest(request), expected);
  if (!verified.ok) return null;
  return { accountId: verified.capability.a, mediaSegments: input.rest };
}
