import type Stripe from "stripe";
import { createAdminClient } from "@/lib/supabase/admin";

export type RecurringGiftAction = "pause" | "resume" | "cancel" | "update_amount";

const KNOWN_STATUSES = new Set([
  "active",
  "past_due",
  "canceled",
  "incomplete",
  "incomplete_expired",
  "paused",
  "trialing",
  "unpaid",
]);

/**
 * The row change a confirmed Stripe call implies, written straight away so the
 * page shows the result without waiting for the webhook. The webhook still
 * reconciles the full row afterwards; this only covers the fields the action
 * changed.
 */
export function subscriptionMirrorPatch(
  action: RecurringGiftAction,
  subscription: Pick<Stripe.Subscription, "status" | "pause_collection">,
  options: { newAmountCents?: number; now?: Date } = {},
): { status: string; paused_at: string | null; amount_cents?: number; updated_at: string } {
  const now = (options.now ?? new Date()).toISOString();
  const status = KNOWN_STATUSES.has(subscription.status) ? subscription.status : "active";
  const patch: { status: string; paused_at: string | null; amount_cents?: number; updated_at: string } = {
    status,
    paused_at: subscription.pause_collection?.behavior != null ? now : null,
    updated_at: now,
  };
  if (action === "update_amount" && options.newAmountCents) {
    patch.amount_cents = options.newAmountCents;
  }
  return patch;
}

/** Best effort: a failed mirror only means the page waits for the webhook. */
export async function mirrorSubscriptionAction(params: {
  churchId: string;
  stripeSubscriptionId: string;
  action: RecurringGiftAction;
  subscription: Pick<Stripe.Subscription, "status" | "pause_collection">;
  newAmountCents?: number;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    await admin
      .from("giving_subscriptions")
      .update(
        subscriptionMirrorPatch(params.action, params.subscription, {
          newAmountCents: params.newAmountCents,
        }),
      )
      .eq("church_id", params.churchId)
      .eq("stripe_subscription_id", params.stripeSubscriptionId);
  } catch {
    // The Stripe webhook will bring the row up to date.
  }
}
