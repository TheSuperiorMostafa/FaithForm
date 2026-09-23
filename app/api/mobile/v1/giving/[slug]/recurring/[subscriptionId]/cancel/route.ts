import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { cancelRecurringGift } from "@/lib/giving/v1/giving-recurring-service";

export const dynamic = "force-dynamic";

/**
 * Stops one recurring gift.
 *
 * ## Why a POST and not a DELETE
 *
 * Because it is not a delete. The subscription row stays, the giving record
 * stays, and the church's books are unchanged; what stops is the next charge.
 * A `DELETE` would promise a removal this never performs.
 *
 * ## Why this stays open when giving is switched off
 *
 * A church turning Giving off must never trap somebody in a recurring charge.
 * The web donor portal made the same call, and the same rule holds here:
 * starting a gift is gated by the feature, stopping one never is.
 *
 * ## What a client may say
 *
 * One FaithForm row id, resolved only for the account that owns it. A gift
 * belonging to another donor, or to another church, reads as "not found"
 * rather than as a refusal that would confirm it exists.
 */
export const POST = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, params }) => {
    const result = await cancelRecurringGift({
      userId,
      churchSlug: params.slug,
      subscriptionId: params.subscriptionId,
    });

    if (!result.ok) {
      if (result.reason === "not_found") {
        throw new MobileError("not_found", "That gift isn't available.");
      }
      // Never reported as stopped on a provider failure: a person told their
      // gift ended, whose card is charged next month, has been lied to.
      throw new MobileError("unavailable", "Couldn't stop that gift. Try again.");
    }

    const { ok: _ok, ...data } = result;
    return { data };
  },
);
