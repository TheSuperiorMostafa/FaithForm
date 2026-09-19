import { NextRequest, NextResponse } from "next/server";

import { authorizeDelivery } from "@/lib/media/v1/media-service";
import {
  DELIVERY_AUTHORIZATION_TTL_MS,
  ExpiringCache,
  withCachedAuthorization,
} from "@/lib/media/v1/delivery-cache";
import {
  isMediaDeliveryToken,
  verifyMediaDeliveryToken,
} from "@/lib/media/v1/playback-capability";
import {
  recordingObjectResponse,
  recordingPlaylistResponse,
} from "@/lib/stream/recording-delivery";

export const dynamic = "force-dynamic";

const recordingAuthorizations = new ExpiringCache<
  NonNullable<Awaited<ReturnType<typeof authorizeDelivery>>>
>(DELIVERY_AUTHORIZATION_TTL_MS);

/**
 * A published livestream recording, as HLS, for the Faithful apps.
 *
 *     /api/media/v1/recording/<churchSlug>/<recordingId>/<deliveryToken>/index.m3u8
 *     /api/media/v1/recording/<churchSlug>/<recordingId>/<deliveryToken>/init/<takeId>.mp4
 *     /api/media/v1/recording/<churchSlug>/<recordingId>/<deliveryToken>/seg/<segmentId>.m4s
 *
 * The same shape as live delivery, for the same reason: a native HLS player
 * cannot put a header on the segment requests it makes, so the account-scoped,
 * domain-separated delivery token rides in the path, and every request is
 * re-authorized against publication, relationship and account (a positive
 * answer is reused for fifteen seconds). An unpublish or a revocation stops a
 * recording that is already playing.
 *
 * A progressive recording keeps its existing route one level up.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string; id: string; rest?: string[] }> },
) {
  const { slug, id, rest = [] } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id) || rest.length < 2) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const [token, ...media] = rest;
  if (!isMediaDeliveryToken(token)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const verified = verifyMediaDeliveryToken(token, {
    churchSlug: slug,
    kind: "recording",
    mediaId: id,
  });
  if (!verified.ok) {
    return NextResponse.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "Cache-Control": "no-store" } },
    );
  }

  const authorized = await withCachedAuthorization(
    recordingAuthorizations,
    [verified.capability.a, slug, id, verified.capability.av].join("|"),
    () =>
      authorizeDelivery({
        accountId: verified.capability.a,
        churchSlug: slug,
        kind: "recording",
        mediaId: id,
        authorizationVersion: verified.capability.av,
      }),
  );
  if (!authorized) {
    return NextResponse.json(
      { error: "Unavailable" },
      { status: 403, headers: { "Cache-Control": "no-store" } },
    );
  }

  if (media.length === 1 && media[0] === "index.m3u8") {
    return recordingPlaylistResponse({
      churchId: authorized.churchId,
      recordingId: id,
      basePath: request.nextUrl.pathname.replace(/\/index\.m3u8$/, ""),
      verifiedOnly: true,
    });
  }

  return recordingObjectResponse({ churchId: authorized.churchId, recordingId: id, rest: media });
}
