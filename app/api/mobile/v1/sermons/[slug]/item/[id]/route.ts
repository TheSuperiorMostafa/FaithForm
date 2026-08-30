import { MobileError } from "@/lib/mobile/v1/errors";
import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { optionalAuthRoute } from "@/lib/mobile/v1/handler";
import { computeEtag, etagMatches } from "@/lib/mobile/v1/protocol";
import { getSermonDetail } from "@/lib/sermons/v1/sermon-service";

export const dynamic = "force-dynamic";

/**
 * One published sermon's notes.
 *
 * Every publication and relationship filter is applied again here rather than
 * assumed from the fact that a list once carried this id. A phone holding a
 * list cached from before an unpublish gets `not_found` when it opens the
 * detail.
 */
export const GET = optionalAuthRoute(
  { cache: "private-revalidate" },
  async ({ userId, request, requestId, params }) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      throw new MobileError("not_found", "That sermon is not available.");
    }

    const detail = await getSermonDetail({
      userId,
      churchSlug: params.slug,
      sermonId: params.id,
    });

    // Unpublished, never published, wrong church, blocked visitor — one answer.
    if (!detail) {
      throw new MobileError("not_found", "That sermon is not available.");
    }

    const etag = computeEtag({
      id: detail.sermonId,
      version: detail.publicationVersion,
      fields: [
        detail.title,
        detail.summary ?? "",
        detail.publishedAt,
        detail.preachedOn ?? "",
        detail.seriesName ?? "",
        detail.scriptureRefs.join("|"),
        // The body is part of the validator: a preacher correcting an outline
        // after publishing must not leave a stale copy on a phone.
        JSON.stringify(detail.outline ?? {}),
        String(detail.discussionQuestions.length),
      ],
      scope: userId ? "member" : "anonymous",
    });

    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return mobileNotModified({ requestId, cache: "private-revalidate", etag });
    }
    return { data: detail, etag };
  },
);
