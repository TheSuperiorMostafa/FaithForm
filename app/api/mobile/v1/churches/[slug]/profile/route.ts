import { MobileError } from "@/lib/mobile/v1/errors";
import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { optionalAuthRoute } from "@/lib/mobile/v1/handler";
import { computeEtag, etagMatches } from "@/lib/mobile/v1/protocol";
import { getChurchProfile } from "@/lib/mobile/v1/discovery-service";

export const dynamic = "force-dynamic";

/**
 * The church profile someone reads before deciding to follow or join.
 *
 * Readable signed out, but the response varies by caller: a signed-in person
 * also sees their own relationship state. That is why it is never shared-cached
 * even though the church half is public.
 *
 * A hidden church and an unknown slug both return 404 — the endpoint must not
 * become an oracle for whether a private church exists.
 */
export const GET = optionalAuthRoute(
  { cache: "private-revalidate" },
  async ({ userId, request, requestId, params }) => {
    const slug = params.slug;
    const profile = await getChurchProfile(userId, slug);
    if (!profile) throw new MobileError("not_found", "Church not found.");

    const etag = computeEtag(profile);
    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return mobileNotModified({ requestId, cache: "private-revalidate", etag });
    }
    return { data: profile, etag };
  },
);
