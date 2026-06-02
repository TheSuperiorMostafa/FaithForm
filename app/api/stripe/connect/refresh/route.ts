import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import { createAdminClient } from "@/lib/supabase/admin";
import { createAccountLink, refreshAccountFromStripe } from "@/lib/stripe/connect";
import { isStripeConfigured } from "@/lib/stripe/client";

export async function POST() {
  if (!isStripeConfigured()) {
    return NextResponse.json(
      { error: "Stripe is not configured" },
      { status: 503 },
    );
  }

  let auth;
  try {
    auth = await requireChurchAuth();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!auth.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const admin = createAdminClient();
  const { data: church } = await admin
    .from("churches")
    .select("id, stripe_account_id")
    .eq("id", auth.churchId)
    .single();

  const stripeAccountId = church?.stripe_account_id as string | null;
  if (!stripeAccountId) {
    return NextResponse.json(
      { error: "No Stripe account. Start onboarding first." },
      { status: 400 },
    );
  }

  await refreshAccountFromStripe(stripeAccountId);
  const url = await createAccountLink(stripeAccountId, church!.id as string);
  return NextResponse.json({ url });
}
