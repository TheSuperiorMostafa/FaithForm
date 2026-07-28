import { NextResponse } from "next/server";
import { z } from "zod";
import { logAdminAction } from "@/lib/activity/admin-log";
import {
  forbiddenResponse,
  requireChurchAdmin,
} from "@/lib/auth/require-church-admin";
import { getDonationById } from "@/lib/queries/giving";
import { refundPaymentIntent } from "@/lib/stripe/giving";
import { featureAccessDenied } from "@/lib/features/guard";

const bodySchema = z.object({
  donationId: z.string().uuid(),
  reason: z.string().max(500).optional(),
});

export async function POST(request: Request) {
  let auth;
  try {
    auth = await requireChurchAdmin();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unauthorized";
    if (message === "Forbidden") return forbiddenResponse();
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const denied = await featureAccessDenied("giving");
  if (denied) return denied;

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
    await logAdminAction({
      churchId: auth.churchId,
      taskName: `Refunded gift ${parsed.data.donationId}`,
      triggerSource: `admin:refund:${parsed.data.donationId}`,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Refund failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
