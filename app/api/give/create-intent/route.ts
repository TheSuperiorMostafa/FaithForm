import { NextResponse } from "next/server";
import { isChurchFeatureEnabled } from "@/lib/features/access";
import { z } from "zod";
import { upsertGivingDonor } from "@/lib/giving/donors";
import { getFundById } from "@/lib/giving/funds";
import { resolveFundStripeAccount } from "@/lib/giving/stripe-accounts";
import { getChurchBySlug } from "@/lib/queries/giving";
import {
  assertRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { createConnectedPaymentIntent } from "@/lib/stripe/giving";
import { isStripeConfigured } from "@/lib/stripe/client";

const bodySchema = z.object({
  slug: z.string().min(1),
  amountCents: z.number().int().min(100),
  intendedAmountCents: z.number().int().min(100).optional(),
  coverFees: z.boolean().optional(),
  donorEmail: z.string().email(),
  donorName: z.string().min(1).max(200),
  fundId: z.string().uuid(),
});

export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Giving unavailable" }, { status: 503 });
  }

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

  const ip = getClientIp(request);
  const rate = await assertRateLimit(`give-intent:${ip}:${parsed.data.slug}`, {
    limit: 20,
    windowMs: 15 * 60 * 1000,
  });
  if (!rate.ok) {
    return rateLimitResponse(rate.retryAfterSeconds);
  }

  const church = await getChurchBySlug(parsed.data.slug);
  if (!church?.stripeAccountId || !church.stripeChargesEnabled) {
    return NextResponse.json({ error: "Giving not available" }, { status: 404 });
  }

  // Giving switched off in the control center stops new money moving. Donor
  // paths that only stop or view an existing gift stay open — a church can
  // turn a feature off, but a donor must always be able to cancel.
  if (!(await isChurchFeatureEnabled(church.churchId, "giving"))) {
    return NextResponse.json({ error: "Giving not available" }, { status: 404 });
  }

  const fund = await getFundById(parsed.data.fundId, church.churchId);
  if (!fund) {
    return NextResponse.json({ error: "Invalid fund" }, { status: 400 });
  }

  // The fund decides which connected account takes the gift. A fund with its
  // own account that cannot take money yet refuses rather than falling back
  // to the main account: Missions money must never land in the General bank.
  const route = await resolveFundStripeAccount(church.churchId, fund.id);
  if (!route.ok) {
    return route.reason === "fund_account_not_ready"
      ? NextResponse.json({ error: "This fund isn't accepting gifts yet. Choose another fund." }, { status: 409 })
      : NextResponse.json({ error: "Giving not available" }, { status: 404 });
  }

  const intendedAmountCents =
    parsed.data.intendedAmountCents ?? parsed.data.amountCents;

  const { donorId } = await upsertGivingDonor({
    churchId: church.churchId,
    email: parsed.data.donorEmail,
    name: parsed.data.donorName,
  });

  const pi = await createConnectedPaymentIntent({
    stripeAccountId: route.stripeAccountId,
    churchId: church.churchId,
    amountCents: parsed.data.amountCents,
    intendedAmountCents,
    coverFees: parsed.data.coverFees ?? false,
    donorEmail: parsed.data.donorEmail,
    donorName: parsed.data.donorName,
    donorId,
    fundId: fund.id,
    fundSlug: fund.slug,
    fundName: fund.name,
  });

  return NextResponse.json({
    clientSecret: pi.client_secret,
    paymentIntentId: pi.id,
    // The browser initialises Stripe.js on this account; it never picks one.
    stripeAccountId: route.stripeAccountId,
  });
}
