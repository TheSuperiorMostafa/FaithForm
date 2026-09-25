"use server";

import { revalidatePath } from "next/cache";

import { getChurchAuth } from "@/lib/auth/church";
import {
  listPublishableFunds,
  publishFundToFaithForm,
  type PublicationResult,
  type MobileVisibility,
  type PublishableFund,
  type StripeReadiness,
} from "@/lib/giving/v1/publication";

/**
 * Publishing giving funds to the FaithForm visitor app.
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

export async function loadFaithFormGiving(): Promise<{
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

  const result = await publishFundToFaithForm({ churchId, ...input });

  if (!result.ok) {
    return { ok: false, error: publicationError(result.reason) };
  }

  revalidatePath("/dashboard/giving");
  revalidatePath("/dashboard/giving/settings");
  revalidatePath("/dashboard/settings");
  return { ok: true };
}

type FailureReason = Extract<PublicationResult, { ok: false }>["reason"];

function publicationError(reason: FailureReason): string {
  switch (reason) {
    // The one refusal worth spelling out: it is fixable, and the fix is
    // somewhere else in this dashboard.
    case "not_accepting_payments":
      return "Your church can't receive gifts yet. Finish connecting your bank, then show this fund in the app.";
    case "fund_inactive":
      return "This fund has been removed. Add it again before showing it in the app.";
    case "invalid_amounts":
      return "Check the smallest, largest and suggested amounts. The smallest gift is $1.";
    case "not_found":
      return "That fund is no longer available. Refresh the page to see your funds.";
    default:
      return "We couldn't save that. Please try again. If it keeps happening, contact FaithForm support.";
  }
}

/** The starter amounts a new fund is shown with in the app. */
const STARTER_SUGGESTED_CENTS = [2500, 5000, 10000];

/**
 * The setup step's "show these funds in the app": each chosen fund is shown
 * to everyone with $25 / $50 / $100 buttons, inside the fund's existing (or
 * the platform's) minimum and maximum. Every fund still goes through
 * `publishFundToFaithForm`, so the payment-readiness and active-fund rules
 * apply exactly as they do in the fund dialog.
 */
export async function showFundsInApp(
  fundIds: string[],
): Promise<{ ok: boolean; shown: number; error?: string }> {
  const { churchId } = await requireAdmin();
  const unique = Array.from(new Set(fundIds)).slice(0, 50);
  if (unique.length === 0) return { ok: true, shown: 0 };

  const state = await listPublishableFunds(churchId).catch(() => null);
  if (!state) {
    return { ok: false, shown: 0, error: "We couldn't load your funds. Please try again." };
  }

  let shown = 0;
  for (const fundId of unique) {
    const fund = state.funds.find((f) => f.fundId === fundId);
    if (!fund) continue;
    const result = await publishFundToFaithForm({
      churchId,
      fundId,
      visibility: fund.visibility === "none" ? "public" : fund.visibility,
      title: fund.title,
      description: fund.description,
      suggestedAmounts:
        fund.suggestedAmounts.length > 0 ? fund.suggestedAmounts : STARTER_SUGGESTED_CENTS,
      minAmountCents: fund.minAmountCents,
      maxAmountCents: fund.maxAmountCents,
    });
    if (!result.ok) {
      revalidatePath("/dashboard/giving");
      return { ok: false, shown, error: publicationError(result.reason) };
    }
    shown += 1;
  }

  revalidatePath("/dashboard/giving");
  revalidatePath("/dashboard/giving/settings");
  return { ok: true, shown };
}
