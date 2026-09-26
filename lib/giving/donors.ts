import { createAdminClient } from "@/lib/supabase/admin";

export type UpsertDonorResult = {
  donorId: string;
  stripeCustomerId: string | null;
};

export async function upsertGivingDonor(params: {
  churchId: string;
  email: string;
  name: string;
  stripeCustomerId?: string | null;
  /**
   * Only for a caller that has proven it is this donor (the donor portal's
   * signed session). The public give form needs nothing but an email, so from
   * there — and from the webhook, whose name came from that form — a name
   * only fills one in that is missing. Otherwise anyone could rename any
   * donor on the church's records and year-end statements.
   */
  replaceName?: boolean;
}): Promise<UpsertDonorResult> {
  const admin = createAdminClient();
  const email = params.email.trim().toLowerCase();
  const now = new Date().toISOString();

  const { data: existing } = await admin
    .from("giving_donors")
    .select("id, stripe_customer_id, name")
    .eq("church_id", params.churchId)
    .eq("email", email)
    .maybeSingle();

  if (existing?.id) {
    await admin
      .from("giving_donors")
      .update({
        name: params.replaceName
          ? params.name || existing.name
          : existing.name || params.name,
        ...(params.stripeCustomerId
          ? { stripe_customer_id: params.stripeCustomerId }
          : {}),
        updated_at: now,
      })
      .eq("id", existing.id);

    return {
      donorId: existing.id as string,
      stripeCustomerId:
        params.stripeCustomerId ??
        (existing.stripe_customer_id as string | null),
    };
  }

  const { data: inserted, error } = await admin
    .from("giving_donors")
    .insert({
      church_id: params.churchId,
      email,
      name: params.name,
      stripe_customer_id: params.stripeCustomerId ?? null,
      updated_at: now,
    })
    .select("id, stripe_customer_id")
    .single();

  if (error || !inserted) {
    throw new Error(error?.message ?? "Failed to create donor");
  }

  return {
    donorId: inserted.id as string,
    stripeCustomerId: inserted.stripe_customer_id as string | null,
  };
}

export async function linkDonorStripeCustomer(
  churchId: string,
  donorId: string,
  stripeCustomerId: string,
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("giving_donors")
    .update({
      stripe_customer_id: stripeCustomerId,
      updated_at: new Date().toISOString(),
    })
    .eq("id", donorId)
    .eq("church_id", churchId);
}
