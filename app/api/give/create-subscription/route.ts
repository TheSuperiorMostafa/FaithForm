import { NextResponse } from "next/server";
import { z } from "zod";
import { linkDonorStripeCustomer, upsertGivingDonor } from "@/lib/giving/donors";
import { getFundById } from "@/lib/giving/funds";
import { getChurchBySlug } from "@/lib/queries/giving";
import { createConnectedSubscription } from "@/lib/stripe/giving";
import { isStripeConfigured } from "@/lib/stripe/client";

const bodySchema = z.object({
  slug: z.string().min(1),
  amountCents: z.number().int().min(100),
  intendedAmountCents: z.number().int().min(100).optional(),
  coverFees: z.boolean().optional(),
  interval: z.enum(["week", "month", "year"]),
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

  const church = await getChurchBySlug(parsed.data.slug);
  if (!church?.stripeAccountId || !church.stripeChargesEnabled) {
    return NextResponse.json({ error: "Giving not available" }, { status: 404 });
  }

  const fund = await getFundById(parsed.data.fundId, church.churchId);
  if (!fund) {
    return NextResponse.json({ error: "Invalid fund" }, { status: 400 });
  }

  const intendedAmountCents =
    parsed.data.intendedAmountCents ?? parsed.data.amountCents;

  const { donorId, stripeCustomerId } = await upsertGivingDonor({
    churchId: church.churchId,
    email: parsed.data.donorEmail,
    name: parsed.data.donorName,
  });

  const { subscription, clientSecret, customerId } =
    await createConnectedSubscription({
      stripeAccountId: church.stripeAccountId,
      churchId: church.churchId,
      amountCents: parsed.data.amountCents,
      intendedAmountCents,
      coverFees: parsed.data.coverFees ?? false,
      interval: parsed.data.interval,
      donorEmail: parsed.data.donorEmail,
      donorName: parsed.data.donorName,
      donorId,
      stripeCustomerId,
      fundId: fund.id,
      fundSlug: fund.slug,
      fundName: fund.name,
    });

  await linkDonorStripeCustomer(donorId, customerId);

  return NextResponse.json({
    subscriptionId: subscription.id,
    clientSecret,
  });
}
