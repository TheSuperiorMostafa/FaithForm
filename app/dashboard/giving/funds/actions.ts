"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createGivingFund } from "@/app/dashboard/settings/giving-actions";
import { requireChurchAuth } from "@/lib/auth/church";
import { toUserError } from "@/lib/errors/user-error";
import { accountCanTakeGifts, mapGivingStripeAccount, GIVING_STRIPE_ACCOUNT_COLUMNS } from "@/lib/giving/stripe-accounts";
import { getGivePageUrl } from "@/lib/stripe/config";
import {
  createFundAccountLink,
  createFundConnectedAccount,
  refreshAccountFromStripe,
} from "@/lib/stripe/connect";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Funds & Banks: which bank each fund's gifts go to.
 *
 * Every action resolves the church from the caller's own session and is
 * admin-only. A bank account number never passes through here: the treasurer
 * enters it in Stripe's own onboarding. Failures come back as plain sentences.
 */

const ADMINS_ONLY = "Only church admins can change where fund gifts go. Ask an admin on your team.";
const ACCOUNT_NOT_FOUND = "That bank account could not be found. Refresh the page and try again.";
const FUND_NOT_FOUND = "That fund could not be found. Refresh the page and try again.";

const bankChoiceSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("main") }),
  z.object({ kind: z.literal("existing"), accountRowId: z.string().uuid() }),
  z.object({
    kind: z.literal("new"),
    label: z.string().trim().min(1).max(80),
    treasurerEmail: z.string().trim().email().max(254).optional().or(z.literal("")),
  }),
]);

export type BankChoice = z.infer<typeof bankChoiceSchema>;

type ActionResult = { error?: string };

async function revalidateFunds(churchId: string) {
  revalidatePath("/dashboard/giving/funds");
  revalidatePath("/dashboard/giving/settings");
  revalidatePath("/dashboard/giving");
  const { data } = await createAdminClient().from("churches").select("slug").eq("id", churchId).maybeSingle();
  if (data?.slug) {
    revalidatePath(`/give/${data.slug}`);
    revalidatePath(`/give/${data.slug}/portal`);
  }
}

async function requireAdmin() {
  const auth = await requireChurchAuth();
  return auth.isAdmin ? auth : null;
}

async function churchForAccounts(churchId: string) {
  const { data } = await createAdminClient()
    .from("churches")
    .select("name, slug, stripe_account_id, stripe_charges_enabled")
    .eq("id", churchId)
    .maybeSingle();
  return data;
}

/**
 * Creates (or, on a repeated request, reuses) a Standard connected account for
 * a bank. The idempotency key is derived from the church, the fund and the
 * label, so pressing the button twice cannot open two Stripe accounts.
 */
async function createAccountForChoice(
  churchId: string,
  fundId: string,
  choice: Extract<BankChoice, { kind: "new" }>,
): Promise<{ accountRowId: string } | { error: string }> {
  const church = await churchForAccounts(churchId);
  if (!church?.stripe_account_id || church.stripe_charges_enabled !== true) {
    return { error: "Connect your church's main bank account first, then add separate banks for funds." };
  }
  try {
    const created = await createFundConnectedAccount({
      churchId,
      churchName: church.name as string,
      label: choice.label,
      treasurerEmail: choice.treasurerEmail ? choice.treasurerEmail : null,
      websiteUrl: church.slug ? getGivePageUrl(church.slug as string) : null,
      attemptKey: createHash("sha256").update(`${churchId}:${fundId}:${choice.label.toLowerCase()}`).digest("hex"),
    });
    return { accountRowId: created.accountRowId };
  } catch (error) {
    console.error("[giving] fund account create failed", { fund: fundId });
    return { error: toUserError(error, "We couldn't start a new bank account with Stripe. Try again in a minute.") };
  }
}

async function readAccount(churchId: string, accountRowId: string) {
  const { data } = await createAdminClient()
    .from("giving_stripe_accounts")
    .select(GIVING_STRIPE_ACCOUNT_COLUMNS)
    .eq("id", accountRowId)
    .eq("church_id", churchId)
    .maybeSingle();
  return data ? mapGivingStripeAccount(data as Record<string, unknown>) : null;
}

/**
 * Points a fund at a bank.
 *
 * - Main account, or another account that is already active: immediate.
 * - A new account, or one still being set up: an existing fund keeps taking
 *   gifts on its current account and switches when the new one is active
 *   (see `syncChurchFromStripeAccount`). A brand-new fund (`isNewFund`) has
 *   nothing to keep, so it is pointed at the account at once and stays off
 *   giving forms until that account is active.
 */
async function applyBankChoice(
  churchId: string,
  fundId: string,
  choice: BankChoice,
  isNewFund: boolean,
): Promise<ActionResult & { accountRowId?: string }> {
  const admin = createAdminClient();

  let accountRowId: string | null = null;
  let ready = true;
  if (choice.kind === "existing") {
    const account = await readAccount(churchId, choice.accountRowId);
    if (!account) return { error: ACCOUNT_NOT_FOUND };
    if (account.isPrimary) {
      accountRowId = null;
    } else {
      accountRowId = account.id;
      ready = accountCanTakeGifts(account);
    }
  } else if (choice.kind === "new") {
    const created = await createAccountForChoice(churchId, fundId, choice);
    if ("error" in created) return { error: created.error };
    accountRowId = created.accountRowId;
    ready = false;
  }

  const update =
    accountRowId === null
      ? { giving_stripe_account_id: null, pending_giving_stripe_account_id: null }
      : ready || isNewFund
        ? { giving_stripe_account_id: accountRowId, pending_giving_stripe_account_id: null }
        : { pending_giving_stripe_account_id: accountRowId };

  const { data: updated, error } = await admin
    .from("giving_funds")
    .update(update)
    .eq("id", fundId)
    .eq("church_id", churchId)
    .eq("is_active", true)
    .select("id");
  if (error) return { error: toUserError(error, "We couldn't change where this fund's gifts go.") };
  if (!updated?.length) return { error: FUND_NOT_FOUND };
  return { accountRowId: accountRowId ?? undefined };
}

/** Settings → Giving → Funds & Banks → Add fund. */
export async function createFundWithBank(input: {
  name: string;
  bank: BankChoice;
}): Promise<ActionResult & { fundId?: string; accountRowId?: string }> {
  const auth = await requireAdmin();
  if (!auth) return { error: ADMINS_ONLY };
  const bank = bankChoiceSchema.safeParse(input.bank);
  if (!bank.success) return { error: "Choose where this fund's gifts should go." };

  const created = await createGivingFund(input.name);
  if (created.error || !created.fundId) return { error: created.error ?? "We couldn't add that fund." };

  const applied = await applyBankChoice(auth.churchId, created.fundId, bank.data, true);
  await revalidateFunds(auth.churchId);
  if (applied.error) {
    return {
      fundId: created.fundId,
      error: `The fund was added and uses your main bank account for now. ${applied.error}`,
    };
  }
  return { fundId: created.fundId, accountRowId: applied.accountRowId };
}

/** Moves an existing fund to a different bank. */
export async function changeFundBank(
  fundId: string,
  bankInput: BankChoice,
): Promise<ActionResult & { accountRowId?: string; switchesWhenReady?: boolean }> {
  const auth = await requireAdmin();
  if (!auth) return { error: ADMINS_ONLY };
  if (!z.string().uuid().safeParse(fundId).success) return { error: FUND_NOT_FOUND };
  const bank = bankChoiceSchema.safeParse(bankInput);
  if (!bank.success) return { error: "Choose where this fund's gifts should go." };

  const applied = await applyBankChoice(auth.churchId, fundId, bank.data, false);
  if (applied.error) return applied;
  await revalidateFunds(auth.churchId);

  let switchesWhenReady = bank.data.kind === "new";
  if (bank.data.kind === "existing" && applied.accountRowId) {
    const account = await readAccount(auth.churchId, applied.accountRowId);
    switchesWhenReady = !account || !accountCanTakeGifts(account);
  }
  return { accountRowId: applied.accountRowId, switchesWhenReady };
}

/**
 * A fresh Stripe onboarding link for a fund's account. Stripe's links are
 * single use and expire, so one is made on every press.
 */
export async function openFundAccountOnboarding(
  accountRowId: string,
): Promise<ActionResult & { url?: string }> {
  const auth = await requireAdmin();
  if (!auth) return { error: ADMINS_ONLY };
  if (!z.string().uuid().safeParse(accountRowId).success) return { error: ACCOUNT_NOT_FOUND };
  const account = await readAccount(auth.churchId, accountRowId);
  if (!account) return { error: ACCOUNT_NOT_FOUND };
  if (account.isPrimary) {
    return { error: "Your main bank account is managed from Giving settings." };
  }
  try {
    return { url: await createFundAccountLink(account.stripeAccountId, account.id) };
  } catch (error) {
    return { error: toUserError(error, "We couldn't open Stripe just now. Try again in a minute.") };
  }
}

/**
 * Reads an account's latest state from Stripe. Called when the treasurer comes
 * back from Stripe's onboarding: `details_submitted` alone is not enough, the
 * fund goes live only when Stripe says the account can charge and pay out.
 */
export async function refreshFundAccount(
  accountRowId: string,
): Promise<ActionResult & { canTakeGifts?: boolean }> {
  const auth = await requireAdmin();
  if (!auth) return { error: ADMINS_ONLY };
  if (!z.string().uuid().safeParse(accountRowId).success) return { error: ACCOUNT_NOT_FOUND };
  const account = await readAccount(auth.churchId, accountRowId);
  if (!account) return { error: ACCOUNT_NOT_FOUND };
  try {
    const fresh = await refreshAccountFromStripe(account.stripeAccountId);
    await revalidateFunds(auth.churchId);
    if (!fresh) {
      return { error: "This bank account is no longer connected. Set it up again to take gifts for its funds." };
    }
    return { canTakeGifts: fresh.charges_enabled === true && fresh.payouts_enabled === true };
  } catch (error) {
    return { error: toUserError(error, "We couldn't check this bank account with Stripe.") };
  }
}

/** Renames how an account is shown in FaithForm. Stripe is not changed. */
export async function renameFundAccount(accountRowId: string, label: string): Promise<ActionResult> {
  const auth = await requireAdmin();
  if (!auth) return { error: ADMINS_ONLY };
  const parsed = z.string().trim().min(1).max(80).safeParse(label);
  if (!parsed.success) return { error: "Give the account a name of up to 80 characters." };
  if (!z.string().uuid().safeParse(accountRowId).success) return { error: ACCOUNT_NOT_FOUND };

  const { data, error } = await createAdminClient()
    .from("giving_stripe_accounts")
    .update({ label: parsed.data, updated_at: new Date().toISOString() })
    .eq("id", accountRowId)
    .eq("church_id", auth.churchId)
    .select("id");
  if (error) return { error: toUserError(error, "We couldn't rename that account.") };
  if (!data?.length) return { error: ACCOUNT_NOT_FOUND };
  await revalidateFunds(auth.churchId);
  return {};
}

/**
 * The fallback bank label when Stripe will not tell FaithForm which bank an
 * account pays into: a display name and the last four digits, never the full
 * number. A bank learned from a real payout is never overwritten by hand.
 */
export async function setFundAccountBankLabel(
  accountRowId: string,
  input: { bankName: string; last4: string },
): Promise<ActionResult> {
  const auth = await requireAdmin();
  if (!auth) return { error: ADMINS_ONLY };
  if (!z.string().uuid().safeParse(accountRowId).success) return { error: ACCOUNT_NOT_FOUND };
  const bankName = z.string().trim().min(1).max(80).safeParse(input.bankName);
  if (!bankName.success) return { error: "Enter the bank's name." };
  if (!/^[0-9]{4}$/.test(input.last4.trim())) {
    return { error: "Enter only the last 4 digits of the account number." };
  }

  const { data, error } = await createAdminClient()
    .from("giving_stripe_accounts")
    .update({
      bank_name: bankName.data,
      bank_last4: input.last4.trim(),
      bank_source: "admin",
      updated_at: new Date().toISOString(),
    })
    .eq("id", accountRowId)
    .eq("church_id", auth.churchId)
    .or("bank_source.is.null,bank_source.eq.admin")
    .select("id");
  if (error) return { error: toUserError(error, "We couldn't save the bank name.") };
  if (!data?.length) {
    return { error: "Stripe already reported this account's bank from a payout, so it can't be edited here." };
  }
  await revalidateFunds(auth.churchId);
  return {};
}
