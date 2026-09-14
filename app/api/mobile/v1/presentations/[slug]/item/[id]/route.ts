import { MobileError } from "@/lib/mobile/v1/errors";
import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { optionalAuthRoute } from "@/lib/mobile/v1/handler";
import { etagMatches } from "@/lib/mobile/v1/protocol";
import { presentationDetailEtag } from "@/lib/sermons/v1/etag";
import { getPresentationDetail } from "@/lib/sermons/v1/presentation-service";

export const dynamic = "force-dynamic";

/** One published presentation (immutable slide manifest). */
export const GET = optionalAuthRoute(
  { cache: "private-revalidate" },
  async ({ userId, request, requestId, params }) => {
    if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
      throw new MobileError("not_found", "That presentation is not available.");
    }

    const detail = await getPresentationDetail({
      userId,
      churchSlug: params.slug,
      presentationId: params.id,
    });

    if (!detail) {
      throw new MobileError("not_found", "That presentation is not available.");
    }

    const etag = presentationDetailEtag(detail, userId ? "member" : "anonymous");

    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return mobileNotModified({ requestId, cache: "private-revalidate", etag });
    }
    return { data: detail, etag };
  },
);
