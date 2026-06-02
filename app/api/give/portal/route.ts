import { NextResponse } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { getChurchBySlug } from "@/lib/queries/giving";
import { createBillingPortalSession } from "@/lib/stripe/giving";
import { getGivePageUrl } from "@/lib/stripe/config";
import { isStripeConfigured } from "@/lib/stripe/client";

const bodySchema = z.object({
  slug: z.string().min(1),
  email: z.string().email(),
});

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

  const church = await getChurchBySlug(parsed.data.slug);
  if (!church?.stripeAccountId) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: sub } = await admin
    .from("giving_subscriptions")
    .select("stripe_customer_id")
    .eq("church_id", church.churchId)
    .ilike("donor_email", parsed.data.email)
    .in("status", ["active", "past_due", "trialing"])
    .limit(1)
    .maybeSingle();

  if (!sub?.stripe_customer_id) {
    return NextResponse.json(
      { error: "No active recurring gift found for this email." },
      { status: 404 },
    );
  }

  const url = await createBillingPortalSession(
    church.stripeAccountId,
    sub.stripe_customer_id as string,
    `${getGivePageUrl(parsed.data.slug)}/manage`,
  );

  return NextResponse.json({ url });
}
