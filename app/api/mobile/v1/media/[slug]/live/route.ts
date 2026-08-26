import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { optionalAuthRoute } from "@/lib/mobile/v1/handler";
import { computeEtag, etagMatches } from "@/lib/mobile/v1/protocol";
import { getLiveMedia } from "@/lib/media/v1/media-service";

export const dynamic = "force-dynamic";

/**
 * What this church is showing right now.
 *
 * Readable signed out — a church's public livestream is public — but what comes
 * back depends on the caller's relationship, so it is never shared-cached and
 * the ETag folds the relationship scope in. The same church at the same version
 * shows different things to a follower and to someone who merely found it.
 *
 * `null` is the normal answer, and the response says so explicitly rather than
 * returning an object with a falsy flag: a home screen must not draw an empty
 * "Live" area on a Tuesday.
 */
export const GET = optionalAuthRoute(
  { cache: "private-revalidate" },
  async ({ userId, request, requestId, params }) => {
    const { live, version } = await getLiveMedia({
      userId,
      churchSlug: params.slug,
    });

    const data = { live, mediaVersion: version };

    const etag = computeEtag({
      version,
      // Every visitor-visible field, so any change to what is on screen
      // produces a new validator — and nothing else does.
      live: live
        ? [
            live.state,
            live.mediaId,
            live.title,
            live.startsAt,
            live.posterUrl ?? "",
            live.countdownEnabled ? "1" : "0",
            live.publicationVersion,
          ]
        : null,
      scope: userId ? "member" : "anonymous",
    });

    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return mobileNotModified({ requestId, cache: "private-revalidate", etag });
    }
    return { data, etag };
  },
);
