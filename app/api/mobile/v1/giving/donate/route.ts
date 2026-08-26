import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { readJsonBody } from "@/lib/mobile/v1/protocol";
import { startDonationRequestSchema } from "@/lib/mobile/v1/contract";
import { startDonation } from "@/lib/giving/v1/giving-service";

export const dynamic = "force-dynamic";

/**
 * Starts, or resumes, one logical donation.
 *
 * ## Why there is no `Idempotency-Key` header here
 *
 * Everywhere else in this API a retry is made safe by a header. Here it is made
 * safe by `clientAttemptId` in the body, and that is a deliberate difference: an
 * idempotency header protects *this request*, while a donation needs the same
 * protection across an app kill, a payment sheet that never returned, and a
 * person who opened the app an hour later. The attempt id is persisted by the
 * client and survives all three; a header generated per request does not.
 *
 * The same id therefore always returns the same payment intent, and never a
 * second charge.
 *
 * ## What a client cannot say
 *
 * Which Stripe account, which currency, what metadata, whether the church may
 * charge at all, or what the platform's amount bounds are. It says a fund, an
 * amount and its own attempt id; everything else is read from the church's rows.
 */
export const POST = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request }) => {
    const parsed = startDonationRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new MobileError("invalid_request", "Could not start that gift.");
    }

    const result = await startDonation({
      userId,
      churchSlug: parsed.data.churchSlug,
      fundId: parsed.data.fundId,
      amountCents: parsed.data.amountCents,
      clientAttemptId: parsed.data.clientAttemptId,
    });

    if (!result.ok) {
      switch (result.reason) {
        case "not_found":
        case "fund_not_found":
          // A church that does not exist, a church that blocked this visitor,
          // and a fund from another church are one answer.
          throw new MobileError("not_found", "That gift isn't available.");
        case "not_accepting":
        case "fund_inactive":
        case "fund_not_published":
          throw new MobileError(
            "conflict",
            "This church isn't accepting gifts in the app right now.",
          );
        case "amount_out_of_range":
          throw new MobileError("invalid_request", "Choose a different amount.", {
            fields: [{ field: "amountCents", issue: "out_of_range" }],
          });
        case "attempt_church_mismatch":
          throw new MobileError("invalid_request", "Could not start that gift.");
        default:
          // A provider failure is never reported as a payment outcome, and no
          // Stripe payload ever crosses this boundary.
          throw new MobileError("unavailable", "Giving is unavailable right now.");
      }
    }

    const { ok: _ok, ...session } = result;
    return { data: session };
  },
);
