import { MobileError } from "@/lib/mobile/v1/errors";
import { authenticatedRoute } from "@/lib/mobile/v1/handler";
import { readJsonBody } from "@/lib/mobile/v1/protocol";
import { startRecurringGiftRequestSchema } from "@/lib/mobile/v1/contract";
import { startRecurringGift } from "@/lib/giving/v1/giving-recurring-service";

export const dynamic = "force-dynamic";

/**
 * Starts, or resumes starting, one recurring gift.
 *
 * ## Why there is no `Idempotency-Key` header here
 *
 * The same reason `../donate` has none, and more of it. An idempotency header
 * protects *this request*; a recurring gift needs protection across an app
 * kill, a payment sheet that never returned, and a person who opened the app an
 * hour later. `clientAttemptId` is persisted by the client and survives all
 * three.
 *
 * The cost of getting this wrong is also higher. A duplicated one-time gift is
 * a refund conversation. A duplicated subscription charges every month until
 * somebody notices.
 *
 * ## What a client cannot say
 *
 * Which Stripe account, which customer, which currency, what metadata, which
 * email the donor record is keyed on, whether the church may charge at all, or
 * what the platform's amount bounds are. It says a fund, an amount, a cadence
 * and its own attempt id; everything else is read from the church's rows and
 * from the caller's own Auth record.
 */
export const POST = authenticatedRoute(
  { cache: "private-no-store" },
  async ({ userId, request }) => {
    const parsed = startRecurringGiftRequestSchema.safeParse(await readJsonBody(request));
    if (!parsed.success) {
      throw new MobileError("invalid_request", "Could not start that gift.");
    }

    const result = await startRecurringGift({
      userId,
      churchSlug: parsed.data.churchSlug,
      fundId: parsed.data.fundId,
      amountCents: parsed.data.amountCents,
      interval: parsed.data.interval,
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
        case "no_email":
          // A recurring gift needs an address to key the church's donor record
          // and to receive its renewal receipts. Said plainly, because it is
          // the one failure here a person can actually fix.
          throw new MobileError(
            "conflict",
            "Add an email to your account to give every week or month.",
          );
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
