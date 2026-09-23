import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { readJsonBody, requireIdempotencyKey } from "@/lib/mobile/v1/protocol";
import { peopleClaimRequestSchema } from "@/lib/mobile/v1/contract";
import { requestPeopleClaim } from "@/lib/faithform/people-claims";

export const dynamic = "force-dynamic";

/**
 * Gives a member a clear, self-serve way to ask the church to match them to
 * People. The church still makes the identity decision; this only opens the
 * existing claim queue and is safe to retry after a lost response.
 */
export const POST = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request }) => {
    requireIdempotencyKey(request);
    const parsed = peopleClaimRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new MobileError("invalid_request", "Choose a church first.");
    }

    const claim = await requestPeopleClaim(userId, parsed.data);
    return {
      data: {
        status: claim.status,
        source: claim.source,
        isLinked: claim.isLinked,
      },
    };
  },
);
