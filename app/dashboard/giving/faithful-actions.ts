"use server";

import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
import {
  listPublishableFunds,
  publishFundToFaithful,
  type MobileVisibility,
  type PublishableFund,
  type StripeReadiness,
} from "@/lib/giving/v1/publication";

/**
 * Publishing giving funds to the Faithful visitor app.
 *
 * Every action resolves the church from the caller's own session. **No action
 * accepts a church id**, so a forged payload cannot publish another church's
 * fund or read its readiness.
 *
 * Nothing here moves money, issues a refund, or reads a donation. Those live in
 * the existing dashboard systems and are untouched by Prompt 11.
 */

async function requireAdmin(): Promise<{ churchId: string }> {
  const auth = await getChurchAuth();
  if (!auth) throw new Error("unauthenticated");
  // Publishing a fund is a money-adjacent decision. Staff who can read a giving
  // page are not automatically people who may put a Give button in an app.
  if (!auth.isAdmin) throw new Error("forbidden");
  return { churchId: auth.churchId };
}

export async function loadFaithfulGiving(): Promise<{
  readiness: StripeReadiness;
  funds: PublishableFund[];
} | null> {
  const auth = await getChurchAuth();
  if (!auth) return null;
  return listPublishableFunds(auth.churchId).catch(() => null);
}

export type SaveFundPublicationInput = {
  fundId: string;
  visibility: MobileVisibility;
  title: string | null;
  description: string | null;
  suggestedAmounts: number[];
  minAmountCents: number;
  maxAmountCents: number;
};

export async function saveFundPublication(
  input: SaveFundPublicationInput,
): Promise<{ ok: boolean; error?: string }> {
  const { churchId } = await requireAdmin();

  const result = await publishFundToFaithful({ churchId, ...input });

  if (!result.ok) {
    return {
      ok: false,
      error:
        result.reason === "not_accepting_payments"
          ? // The one refusal worth spelling out: it is fixable, and the fix is
            // somewhere else in this dashboard.
            "This church can't accept payments yet. Finish Stripe setup before publishing a fund to the app."
          : result.reason === "fund_inactive"
            ? "Make this fund active before publishing it."
            : result.reason === "invalid_amounts"
              ? "Check the minimum, maximum and suggested amounts."
              : result.reason === "not_found"
                ? "That fund is no longer available."
                : "Could not save that.",
    };
  }

  revalidatePath("/dashboard/giving");
  revalidatePath("/dashboard/settings");
  return { ok: true };
}
