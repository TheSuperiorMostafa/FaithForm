import { mobileNotModified } from "@/lib/mobile/v1/envelope";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { computeEtag, etagMatches } from "@/lib/mobile/v1/protocol";
import { getGivingHome } from "@/lib/giving/v1/giving-service";

export const dynamic = "force-dynamic";

/**
 * The funds this visitor may give to at this church.
 *
 * **Authenticated, unlike the media archive.** Giving is not browsable: a fund
 * published to members is a fact about a church's membership, and the
 * relationship that decides it only exists for a signed-in account.
 *
 * A church that cannot accept payments returns no funds and an availability of
 * `notAccepting`, rather than a list the visitor would fail to pay against.
 */
export const GET = authenticatedRoute(
  { cache: "private-revalidate" },
  async ({ userId, request, requestId, params }) => {
    const data = await getGivingHome({ userId, churchSlug: params.slug });

    const etag = computeEtag({
      version: data.givingVersion,
      availability: data.availability,
      // The per-fund version is what makes an edit to any single fund change the
      // list's validator.
      funds: data.funds.map((fund) => `${fund.fundId}:${fund.publicationVersion}`),
      recurring: data.recurringAvailable ? "1" : "0",
    });

    if (etagMatches(request.headers.get("if-none-match"), etag)) {
      return mobileNotModified({ requestId, cache: "private-revalidate", etag });
    }
    return { data, etag };
  },
);
