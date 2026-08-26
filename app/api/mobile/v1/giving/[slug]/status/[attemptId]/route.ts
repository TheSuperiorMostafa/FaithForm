import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { getDonationStatus } from "@/lib/giving/v1/giving-service";

export const dynamic = "force-dynamic";

/**
 * What the **server** believes happened to one attempt.
 *
 * This is what a phone polls after its payment sheet closes, and it is the only
 * thing that may move it off a processing screen. The sheet's own success
 * callback reports that an SDK finished; this reports what a verified Stripe
 * webhook wrote.
 *
 * Never cached: a donation's state is the one thing in this API where a stale
 * answer is actively harmful.
 */
export const GET = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, params }) => {
    const status = await getDonationStatus({
      userId,
      churchSlug: params.slug,
      attemptId: params.attemptId,
    });

    // Another donor's attempt, another church's attempt, and an attempt that
    // never existed are one answer.
    if (!status) throw new MobileError("not_found", "That gift isn't available.");

    return { data: status };
  },
);
