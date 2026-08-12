import { NextResponse } from "next/server";
import { isChurchFeatureEnabled } from "@/lib/features/access";
import { createAdminClient } from "@/lib/supabase/admin";
import { getDonorPortalSession } from "@/lib/giving/portal-session";
import { createSetupIntent } from "@/lib/stripe/giving";

export async function POST(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const session = await getDonorPortalSession(slug);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Saving a new card is setup for future charges, so it stops with the
  // feature. Cancelling an existing gift does not — see ../subscription.
  if (!(await isChurchFeatureEnabled(session.churchId, "giving"))) {
    return NextResponse.json({ error: "Giving not available" }, { status: 404 });
  }

  const admin = createAdminClient();
  const { data: donor } = await admin
    .from("giving_donors")
    .select("stripe_customer_id")
    .eq("id", session.donorId)
    .single();

  const { data: church } = await admin
    .from("churches")
    .select("stripe_account_id")
    .eq("id", session.churchId)
    .single();

  const customerId = donor?.stripe_customer_id as string | null;
  const stripeAccountId = church?.stripe_account_id as string | null;

  if (!customerId || !stripeAccountId) {
    return NextResponse.json(
      { error: "No payment profile found. Make a gift first." },
      { status: 400 },
    );
  }

  const clientSecret = await createSetupIntent(stripeAccountId, customerId);
  return NextResponse.json({ clientSecret });
}
