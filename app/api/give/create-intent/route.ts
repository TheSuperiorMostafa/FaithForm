import { NextResponse } from "next/server";
import { z } from "zod";
import { upsertGivingDonor } from "@/lib/giving/donors";
import { getFundById } from "@/lib/giving/funds";
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

  const fund = await getFundById(parsed.data.fundId, church.churchId);
  if (!fund) {
    return NextResponse.json({ error: "Invalid fund" }, { status: 400 });
  }

  const intendedAmountCents =
    parsed.data.intendedAmountCents ?? parsed.data.amountCents;

  const { donorId } = await upsertGivingDonor({
    churchId: church.churchId,
    email: parsed.data.donorEmail,
    name: parsed.data.donorName,
  });

  const pi = await createConnectedPaymentIntent({
    stripeAccountId: church.stripeAccountId,
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
  });
}
