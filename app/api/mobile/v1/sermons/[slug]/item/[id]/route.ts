import { MobileError } from "@/lib/mobile/v1/errors";
import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { optionalAuthRoute } from "@/lib/mobile/v1/handler";
import { etagMatches } from "@/lib/mobile/v1/protocol";
import { sermonDetailEtag } from "@/lib/sermons/v1/etag";
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

    // Over the whole body: a preacher correcting an outline or a discussion
    // question after sharing must not leave a stale copy on a phone.
    const etag = sermonDetailEtag(detail, userId ? "member" : "anonymous");

    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return mobileNotModified({ requestId, cache: "private-revalidate", etag });
    }
    return { data: detail, etag };
  },
);
