import { NextResponse } from "next/server";
import { z } from "zod";
import { getChurchAuth } from "@/lib/auth/church";
import { getDonationById } from "@/lib/queries/giving";
import { refundPaymentIntent } from "@/lib/stripe/giving";

const bodySchema = z.object({
  donationId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  const auth = await getChurchAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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

  const donation = await getDonationById(auth.churchId, parsed.data.donationId);
  if (!donation?.stripePaymentIntentId || !donation.stripeAccountId) {
    return NextResponse.json({ error: "Gift not found" }, { status: 404 });
  }

  if (donation.status !== "succeeded") {
    return NextResponse.json({ error: "Only succeeded gifts can be refunded" }, { status: 400 });
  }

  try {
    await refundPaymentIntent(
      donation.stripeAccountId,
      donation.stripePaymentIntentId,
      parsed.data.reason,
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Refund failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
