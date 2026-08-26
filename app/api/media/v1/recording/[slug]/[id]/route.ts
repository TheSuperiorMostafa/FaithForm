import { NextRequest, NextResponse } from "next/server";

import {
  capabilityFromRequest,
  verifyMediaCapability,
} from "@/lib/media/v1/playback-capability";
import { authorizeDelivery } from "@/lib/media/v1/media-service";
import { identityMatches, responseIdentity } from "@/lib/media/v1/rendition-check";
import { STREAM_RECORDINGS_BUCKET } from "@/lib/stream/recording-storage";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

const NO_STORE = "private, no-cache, no-store, must-revalidate";

/**
 * A published recording, streamed through the server.
 *
 * ## Why this proxies instead of redirecting
 *
 * Recordings live in a **private** bucket. The dashboard's media page reads them
 * with `createSignedUrl(path, 4 hours)` — fine behind a staff session on a
 * laptop, and exactly wrong to hand to a phone: a four-hour provider URL is a
 * four-hour bearer token for a video file, it survives a screenshot and a share
 * sheet, and no unpublish can take it back.
 *
 * So the signed URL is created here with a **sixty-second** life, used
 * immediately by this process, and never sent anywhere. What the player holds
 * is a five-minute, account-scoped capability against this route.
 *
 * ## Why the archive is progressive rather than HLS
 *
 * The relay writes MP4/MOV files. There is no per-recording HLS packaging in
 * this repository, and adding one would be a second recording authority. Both
 * `AVPlayer` and `Media3` play progressive MP4 with seeking, so the honest
 * answer is a byte-range proxy — which is what this is.
 *
 * `Range` is forwarded and `Content-Range`/`Accept-Ranges` are passed back,
 * because without them neither player can seek and both will refuse to scrub.
 *
 * ## Why it serves an object rather than a path
 *
 * A storage path is mutable: `infra/stream-relay/upload-recording.sh` uploads
 * with `x-upsert: true`, so a re-run replaces the object underneath an unchanged
 * path. A route that resolves a path and streams whatever is there would happily
 * serve a file nobody verified, to a capability minted for a file that no longer
 * exists.
 *
 * So the grant carries the identity of the verified bytes, and this route both
 * **pins** the request to them — `If-Match`, so storage refuses rather than
 * substitutes — and **checks** what came back. Pinning alone would not be
 * enough: a provider that ignores `If-Match` would silently succeed. Checking
 * alone would not be enough either: it would transfer the wrong bytes first.
 * Doing both means the wrong object is refused whether or not the provider
 * cooperates.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string }> },
) {
  const { slug, id } = await params;

  if (!/^[0-9a-f-]{36}$/i.test(id)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const verified = verifyMediaCapability(capabilityFromRequest(request), {
    churchSlug: slug,
    kind: "recording",
    mediaId: id,
  });
  if (!verified.ok) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": NO_STORE } },
    );
  }

  // Re-checked per request. A recording unpublished or revoked mid-playback
  // stops on the next range request rather than at the next capability refresh.
  const authorized = await authorizeDelivery({
    accountId: verified.capability.a,
    churchSlug: slug,
    kind: "recording",
    mediaId: id,
  });
  if (!authorized?.storagePath) {
    return NextResponse.json(
      { error: "Unavailable" },
      { status: 403, headers: { "Cache-Control": NO_STORE } },
    );
  }

  // **The storage path came from the database, never from the request.** The
  // route's only input is a recording id, which the grant function resolved.
  const admin = createAdminClient();
  const { data: signed } = await admin.storage
    .from(STREAM_RECORDINGS_BUCKET)
    .createSignedUrl(authorized.storagePath, 60);

  if (!signed?.signedUrl) {
    return NextResponse.json(
      { error: "Playback unavailable" },
      { status: 503, headers: { "Cache-Control": NO_STORE } },
    );
  }

  let upstream: Response;
  try {
    const range = request.headers.get("range");
    const headers: Record<string, string> = range ? { Range: range } : {};
    // Pin the request to the verified object. A provider that honours this
    // answers 412 rather than handing back a replacement.
    if (authorized.identity.etag) headers["If-Match"] = authorized.identity.etag;

    upstream = await fetch(signed.signedUrl, {
      cache: "no-store",
      redirect: "follow",
      signal: request.signal,
      headers,
    });
  } catch {
    if (request.signal.aborted) return new NextResponse(null, { status: 499 });
    return NextResponse.json(
      { error: "Playback unavailable" },
      { status: 502, headers: { "Cache-Control": NO_STORE } },
    );
  }

  // 412 is the pin doing its job: the object at this path is no longer the one
  // that was verified. Reported as unavailable, like every other refusal on this
  // route, so a caller learns nothing about why.
  if (upstream.status === 412) {
    return NextResponse.json(
      { error: "Unavailable" },
      { status: 403, headers: { "Cache-Control": NO_STORE } },
    );
  }

  if (!upstream.ok && upstream.status !== 206) {
    // The storage error body can name a bucket and a path. Only the class of
    // failure crosses back.
    return NextResponse.json(
      { error: "Playback unavailable" },
      {
        status: upstream.status >= 400 ? upstream.status : 502,
        headers: { "Cache-Control": NO_STORE },
      },
    );
  }

  // And check what actually came back, because a provider that ignores
  // `If-Match` would have succeeded above. `identityMatches` compares only the
  // discriminators both sides know, so a provider that returns no validator does
  // not invalidate a whole archive — but one that returns a *different* one
  // stops here, before a single byte of the wrong file reaches a phone.
  if (!identityMatches(authorized.identity, responseIdentity(upstream.headers))) {
    await upstream.body?.cancel();
    return NextResponse.json(
      { error: "Unavailable" },
      { status: 403, headers: { "Cache-Control": NO_STORE } },
    );
  }

  const headers = new Headers({
    "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
    "Cache-Control": NO_STORE,
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    // Seeking depends on this being visible to the player.
    "Accept-Ranges": "bytes",
  });
  for (const header of ["content-length", "content-range"]) {
    const value = upstream.headers.get(header);
    if (value) headers.set(header, value);
  }

  return new NextResponse(upstream.body, { status: upstream.status, headers });
}
