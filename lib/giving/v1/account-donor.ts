import type { SupabaseClient } from "@supabase/supabase-js";

import { getAuthUsersByIds } from "@/lib/auth/auth-users";
import { upsertGivingDonor } from "@/lib/giving/donors";

/** The signed-in account's own address, from Auth. Never a client value. */
export async function accountEmail(userId: string): Promise<string | null> {
  const users = await getAuthUsersByIds([userId]);
  const email = users.get(userId)?.email ?? null;
  const trimmed = email?.trim().toLowerCase();
  return trimmed ? trimmed : null;
}

export async function readDonor(
  donorId: string,
  churchId: string,
  db: SupabaseClient,
): Promise<{ email: string; name: string | null; stripeCustomerId: string | null } | null> {
  const { data } = await db
    .from("giving_donors")
    .select("email, name, stripe_customer_id")
    .eq("id", donorId)
    .eq("church_id", churchId)
    .maybeSingle();

  if (!data?.email) return null;
  return {
    email: data.email as string,
    name: (data.name as string | null) ?? null,
    stripeCustomerId: (data.stripe_customer_id as string | null) ?? null,
  };
}

export type AccountDonor = {
  donorId: string;
  email: string;
  name: string | null;
  /** The donor's Stripe customer at this church, when it has one. */
  customerId: string | null;
};

/**
 * The church's donor this account gives as, created on its first gift.
 *
 * The address comes from Auth, never the client. `link_giving_donor` is
 * first-write-wins, so an account that already gave here keeps the donor it
 * had, however many addresses it has worn since. Every gift — one-time or
 * recurring — goes through here, which is what lets the giver sign in to the
 * donor portal with that address.
 */
export async function donorForAccount(input: {
  userId: string;
  accountId: string;
  displayName: string | null;
  churchId: string;
  db: SupabaseClient;
}): Promise<{ ok: true; donor: AccountDonor } | { ok: false; reason: "no_email" | "unavailable" }> {
  const email = await accountEmail(input.userId);
  if (!email) return { ok: false, reason: "no_email" };

  // An existing donor is used as it is: its name may be the one they typed on
  // the web, and a gift from the app shouldn't rename it (or write at all).
  const { data: existing } = await input.db
    .from("giving_donors")
    .select("id")
    .eq("church_id", input.churchId)
    .eq("email", email)
    .maybeSingle();
  const donorId =
    (existing?.id as string | undefined) ??
    (
      await upsertGivingDonor({
        churchId: input.churchId,
        email,
        name: input.displayName ?? email,
      })
    ).donorId;

  const { data: linkData } = await input.db.rpc("link_giving_donor", {
    p_account_id: input.accountId,
    p_church_id: input.churchId,
    p_donor_id: donorId,
  });
  const link = ((linkData ?? []) as Record<string, unknown>[])[0];
  if (!link?.ok) return { ok: false, reason: "unavailable" };

  const effectiveDonorId = (link.donor_id as string) ?? donorId;
  const donor = await readDonor(effectiveDonorId, input.churchId, input.db);
  if (!donor) return { ok: false, reason: "unavailable" };

  return {
    ok: true,
    donor: {
      donorId: effectiveDonorId,
      email: donor.email,
      name: donor.name,
      customerId: donor.stripeCustomerId,
    },
  };
}
