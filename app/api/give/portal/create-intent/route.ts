import { NextResponse } from "next/server";
import { isChurchFeatureEnabled } from "@/lib/features/access";
import { z } from "zod";
import { upsertGivingDonor } from "@/lib/giving/donors";
import { getDonorPortalSession } from "@/lib/giving/portal-session";
import { getFundById } from "@/lib/giving/funds";
import { getChurchBySlug } from "@/lib/queries/giving";
import { createConnectedPaymentIntent } from "@/lib/stripe/giving";
import { isStripeConfigured } from "@/lib/stripe/client";
import { createAdminClient } from "@/lib/supabase/admin";

const bodySchema = z.object({
  slug: z.string().min(1),
  amountCents: z.number().int().min(100),
  intendedAmountCents: z.number().int().min(100).optional(),
  coverFees: z.boolean().optional(),
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

  const session = await getDonorPortalSession(parsed.data.slug);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  if (session.churchId !== church.churchId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const { data: donor } = await admin
    .from("giving_donors")
    .select("id, email")
    .eq("id", session.donorId)
    .eq("church_id", church.churchId)
    .maybeSingle();

  if (!donor?.email) {
    return NextResponse.json({ error: "Donor not found" }, { status: 404 });
  }

  const fund = await getFundById(parsed.data.fundId, church.churchId);
  if (!fund) {
    return NextResponse.json({ error: "Invalid fund" }, { status: 400 });
  }

  const donorEmail = donor.email as string;
  const intendedAmountCents =
    parsed.data.intendedAmountCents ?? parsed.data.amountCents;

  const { donorId } = await upsertGivingDonor({
    churchId: church.churchId,
    email: donorEmail,
    name: parsed.data.donorName,
  });

  const pi = await createConnectedPaymentIntent({
    stripeAccountId: church.stripeAccountId,
    churchId: church.churchId,
    amountCents: parsed.data.amountCents,
    intendedAmountCents,
    coverFees: parsed.data.coverFees ?? false,
    donorEmail,
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
