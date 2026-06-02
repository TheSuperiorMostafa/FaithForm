import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  createAccountLink,
  createConnectedAccount,
  refreshAccountFromStripe,
} from "@/lib/stripe/connect";
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
  const { data: church, error } = await admin
    .from("churches")
    .select("id, name, stripe_account_id")
    .eq("id", auth.churchId)
    .single();

  if (error || !church) {
    return NextResponse.json({ error: "Church not found" }, { status: 404 });
  }

  let stripeAccountId = church.stripe_account_id as string | null;

  if (!stripeAccountId) {
    const account = await createConnectedAccount(
      church.id as string,
      church.name as string,
    );
    stripeAccountId = account.id;
  } else {
    await refreshAccountFromStripe(stripeAccountId);
  }

  const url = await createAccountLink(stripeAccountId, church.id as string);
  return NextResponse.json({ url });
}
