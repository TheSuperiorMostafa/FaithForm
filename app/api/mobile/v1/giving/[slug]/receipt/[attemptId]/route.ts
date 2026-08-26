import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { getGivingReceipt } from "@/lib/giving/v1/giving-service";

export const dynamic = "force-dynamic";

/**
 * A receipt for one gift.
 *
 * Exists only once a Stripe webhook has confirmed the payment succeeded — the
 * SQL requires it on both the attempt and the donation. Before then this is a
 * 404, which is what stops a payment sheet's own callback from producing a
 * receipt for a gift that has not settled.
 *
 * Reached through the **attempt**, which is bound to an account. There is no
 * donation-id path and no email path, so a receipt cannot be fetched by knowing
 * an identifier.
 *
 * Carries no donor email, no Stripe identifier, no fee, no net amount, and no
 * tax language: nothing in the dashboard records deductibility, so the word is
 * "receipt".
 */
export const GET = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, params }) => {
    const receipt = await getGivingReceipt({
      userId,
      churchSlug: params.slug,
      attemptId: params.attemptId,
    });

    if (!receipt) throw new MobileError("not_found", "That receipt isn't available.");

    return { data: receipt };
  },
);
