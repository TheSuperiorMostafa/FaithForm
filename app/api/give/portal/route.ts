import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChurchBySlug } from "@/lib/queries/giving";
import { createBillingPortalSession } from "@/lib/stripe/giving";
import { getGivePageUrl } from "@/lib/stripe/config";
import { isStripeConfigured } from "@/lib/stripe/client";
import {
  assertRateLimit,
  getClientIp,
  rateLimitResponse,
} from "@/lib/security/rate-limit";

const bodySchema = z.object({
  slug: z.string().min(1),
  email: z.string().email(),
});

const GENERIC_MESSAGE =
  "If an active recurring gift exists for this email, use the donor portal sign-in link we emailed you.";

export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return NextResponse.json({ error: "Unavailable" }, { status: 503 });
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
  const rate = await assertRateLimit(`portal-billing:${ip}:${parsed.data.slug}`, {
    limit: 10,
    windowMs: 15 * 60 * 1000,
  });
  if (!rate.ok) {
    return rateLimitResponse(rate.retryAfterSeconds);
  }

  const church = await getChurchBySlug(parsed.data.slug);
  if (!church?.stripeAccountId) {
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }

  const admin = createAdminClient();
  const email = parsed.data.email.trim().toLowerCase();
  const { data: sub } = await admin
    .from("giving_subscriptions")
    .select("stripe_customer_id")
    .eq("church_id", church.churchId)
    .ilike("donor_email", email)
    .in("status", ["active", "past_due", "trialing"])
    .limit(1)
    .maybeSingle();

  if (!sub?.stripe_customer_id) {
    return NextResponse.json({ ok: true, message: GENERIC_MESSAGE });
  }

  const url = await createBillingPortalSession(
    church.stripeAccountId,
    sub.stripe_customer_id as string,
    `${getGivePageUrl(parsed.data.slug)}/manage`,
  );

  return NextResponse.json({ ok: true, url });
}
