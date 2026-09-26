import { MobileError } from "@/lib/mobile/v1/errors";
import { checkRateLimit } from "@/lib/security/rate-limit";

/**
 * How often one account may start or resume a gift from the phone.
 *
 * Each new attempt id creates a payment intent (or a customer and subscription)
 * on the church's own Stripe account, and hands back a client secret a card can
 * be tried against. Without a bound, one free account could test stolen cards
 * against a church — whose Stripe account pays the disputes and can be frozen
 * for it. The web give form has always had its own limit; this is the app's.
 *
 * Generous on purpose: a resume counts too, and a real person retrying a
 * declined card a few times must never meet it. One-time and recurring share
 * the budget, because card testing does not care which door it uses.
 */
export async function assertGivingStartAllowed(userId: string): Promise<void> {
  const budget = await checkRateLimit(`giving-start:${userId}`, {
    limit: 30,
    windowMs: 60 * 60 * 1000,
  });
  if (!budget.ok) {
    throw new MobileError(
      budget.reason === "limited" ? "rate_limited" : "unavailable",
      "Please wait a little and try again.",
      { retryAfterSeconds: budget.retryAfterSeconds },
    );
  }
}
