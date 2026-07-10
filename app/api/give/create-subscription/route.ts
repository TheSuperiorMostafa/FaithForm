import { NextResponse } from "next/server";
import { z } from "zod";
import { linkDonorStripeCustomer, upsertGivingDonor } from "@/lib/giving/donors";
import { getFundById } from "@/lib/giving/funds";
import { getChurchBySlug } from "@/lib/queries/giving";
import {
  assertRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/security/rate-limit";
import { createConnectedSubscription } from "@/lib/stripe/giving";
import { isStripeConfigured } from "@/lib/stripe/client";

const bodySchema = z
  .object({
    slug: z.string().min(1),
    amountCents: z.number().int().min(100),
    intendedAmountCents: z.number().int().min(100).optional(),
    coverFees: z.boolean().optional(),
    interval: z.enum(["week", "month", "year"]),
    billingDayOfMonth: z.number().int().min(1).max(28).optional(),
    billingDayOfWeek: z.number().int().min(0).max(6).optional(),
    donorEmail: z.string().email(),
    donorName: z.string().min(1).max(200),
    fundId: z.string().uuid(),
  })
  .superRefine((data, ctx) => {
    if (data.interval === "month" && data.billingDayOfMonth == null) {
      ctx.addIssue({
        code: "custom",
        message: "billingDayOfMonth is required for monthly gifts",
        path: ["billingDayOfMonth"],
      });
    }
    if (data.interval === "week" && data.billingDayOfWeek == null) {
      ctx.addIssue({
        code: "custom",
        message: "billingDayOfWeek is required for weekly gifts",
        path: ["billingDayOfWeek"],
      });
    }
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
  const rate = await assertRateLimit(`give-sub:${ip}:${parsed.data.slug}`, {
    limit: 10,
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
      billingDayOfMonth: parsed.data.billingDayOfMonth,
      billingDayOfWeek: parsed.data.billingDayOfWeek,
      donorEmail: parsed.data.donorEmail,
      donorName: parsed.data.donorName,
      donorId,
      stripeCustomerId,
      fundId: fund.id,
      fundSlug: fund.slug,
      fundName: fund.name,
    });

  await linkDonorStripeCustomer(church.churchId, donorId, customerId);

  return NextResponse.json({
    subscriptionId: subscription.id,
    clientSecret,
  });
}
