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
import { refundErrorMessage } from "@/lib/giving/provider-errors";

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
    return NextResponse.json(
      { error: "We couldn't read that request. Refresh the page and try again." },
      { status: 400 },
    );
  }

  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "We couldn't tell which gift to refund. Refresh the page and try again." },
      { status: 400 },
    );
  }

  const donation = await getDonationById(auth.churchId, parsed.data.donationId);
  if (!donation?.stripePaymentIntentId || !donation.stripeAccountId) {
    return NextResponse.json(
      { error: "We couldn't find that gift. Refresh the page and try again." },
      { status: 404 },
    );
  }

  if (donation.status !== "succeeded") {
    return NextResponse.json(
      { error: "Only received gifts can be refunded. This one isn't marked as received." },
      { status: 400 },
    );
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
    // The provider's own text stays in the log; the treasurer gets a sentence.
    console.error("[giving] refund failed", parsed.data.donationId, err);
    return NextResponse.json({ error: refundErrorMessage(err) }, { status: 500 });
  }
}
