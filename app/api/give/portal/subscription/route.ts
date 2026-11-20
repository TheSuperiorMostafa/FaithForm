import { NextResponse } from "next/server";
import { z } from "zod";
import { isPublicFeatureEnabled } from "@/lib/features/public-access";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDonorPortalSession } from "@/lib/giving/portal-session";
import {
  cancelSubscription,
  pauseSubscription,
  resumeSubscription,
  updateSubscriptionAmount,
} from "@/lib/stripe/giving";
import { mirrorSubscriptionAction } from "@/lib/giving/subscription-mirror";

const bodySchema = z.object({
  slug: z.string().min(1),
  action: z.enum(["pause", "resume", "cancel", "update_amount"]),
  subscriptionId: z.string().uuid(),
  newAmountCents: z.number().int().min(100).optional(),
});

export async function POST(request: Request) {
  let json: unknown;
  try {
    json = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const session = await getDonorPortalSession(parsed.data.slug);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Turning Giving off must never trap a donor in a recurring charge, so
  // pausing and cancelling stay available whatever the flag says. Resuming and
  // raising an amount restart money moving, so they stop with the feature.
  const restartsGiving =
    parsed.data.action === "resume" || parsed.data.action === "update_amount";

  if (
    restartsGiving &&
    !(await isPublicFeatureEnabled(session.churchId, "giving"))
  ) {
    return NextResponse.json({ error: "Giving not available" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("giving_subscriptions")
    .select(
      "stripe_subscription_id, donor_id, amount_cents, giving_funds ( name )",
    )
    .eq("id", parsed.data.subscriptionId)
    .eq("church_id", session.churchId)
    .eq("donor_id", session.donorId)
    .maybeSingle();

  if (!sub) {
    return NextResponse.json({ error: "Subscription not found" }, { status: 404 });
  }

  const { data: church } = await admin
    .from("churches")
    .select("stripe_account_id")
    .eq("id", session.churchId)
    .single();

  const stripeAccountId = church?.stripe_account_id as string | null;
  const stripeSubId = sub.stripe_subscription_id as string;
  if (!stripeAccountId) {
    return NextResponse.json({ error: "Giving unavailable" }, { status: 503 });
  }

  const fundRaw = sub.giving_funds as
    | { name: string }
    | { name: string }[]
    | null;
  const fund = Array.isArray(fundRaw) ? fundRaw[0] : fundRaw;
  const fundName = fund?.name ?? "General";

  if (parsed.data.action === "update_amount" && !parsed.data.newAmountCents) {
    return NextResponse.json({ error: "Amount required" }, { status: 400 });
  }

  try {
    const { action, newAmountCents } = parsed.data;
    const subscription =
      action === "pause"
        ? await pauseSubscription(stripeAccountId, stripeSubId)
        : action === "resume"
          ? await resumeSubscription(stripeAccountId, stripeSubId)
          : action === "cancel"
            ? await cancelSubscription(stripeAccountId, stripeSubId)
            : await updateSubscriptionAmount(
                stripeAccountId,
                stripeSubId,
                newAmountCents as number,
                fundName,
              );
    // Save the result now so the portal updates without a refresh; the
    // webhook reconciles the rest of the row when it arrives.
    await mirrorSubscriptionAction({
      churchId: session.churchId,
      stripeSubscriptionId: stripeSubId,
      action,
      subscription,
      newAmountCents,
    });
    return NextResponse.json({ ok: true, status: subscription.status });
  } catch {
    return NextResponse.json({ error: "Action failed" }, { status: 500 });
  }
}
