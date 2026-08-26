import { MobileError } from "@/lib/mobile/v1/errors";
import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { optionalAuthRoute } from "@/lib/mobile/v1/handler";
import { computeEtag, etagMatches } from "@/lib/mobile/v1/protocol";
import { getMediaDetail } from "@/lib/media/v1/media-service";

export const dynamic = "force-dynamic";

/**
 * One published recording.
 *
 * Every publication and relationship filter is applied again here rather than
 * assumed from the fact that a list once carried this id. A phone holding a
 * list cached from before an unpublish gets `not_found` when it opens the
 * detail — which is what "unpublish removes it from list *and* detail
 * projections" has to mean in practice.
 */
export const GET = optionalAuthRoute(
  { cache: "private-revalidate" },
  async ({ userId, request, requestId, params }) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      throw new MobileError("not_found", "That recording is not available.");
    }

    const detail = await getMediaDetail({
      userId,
      churchSlug: params.slug,
      mediaId: params.id,
    });

    // Unpublished, revoked, never published, wrong church, blocked visitor —
    // one answer for all of them.
    if (!detail) throw new MobileError("not_found", "That recording is not available.");

    const etag = computeEtag({
      id: detail.mediaId,
      version: detail.publicationVersion,
      fields: [
        detail.title,
        detail.summary ?? "",
        detail.publishedAt,
        detail.durationSeconds ?? -1,
        detail.posterUrl ?? "",
        detail.seriesName ?? "",
        detail.speakers.join("|"),
        detail.chapters.join("|"),
        detail.topics.join("|"),
        detail.startOffsetSeconds,
      ],
      scope: userId ? "member" : "anonymous",
    });

    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return mobileNotModified({ requestId, cache: "private-revalidate", etag });
    }
    return { data: detail, etag };
  },
);
