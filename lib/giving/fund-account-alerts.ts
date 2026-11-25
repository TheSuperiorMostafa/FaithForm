import { createAdminClient } from "@/lib/supabase/admin";
import { sendGivingAdminAlertEmail } from "@/lib/email/giving";
import { getChurchTeamMembers } from "@/lib/queries/team";
import { getSiteUrl } from "@/lib/stripe/config";
import { isMissingFundAccountSchema } from "@/lib/giving/stripe-accounts";

/**
 * The names of the funds whose gifts go to one connected account, for alerts
 * and logs. The primary account carries every fund with no account of its own.
 */
export async function fundNamesForStripeAccount(
  churchId: string,
  stripeAccountId: string,
): Promise<{ label: string; funds: string[] }> {
  const admin = createAdminClient();
  const [{ data: row, error: rowError }, { data: church }] = await Promise.all([
    admin
      .from("giving_stripe_accounts")
      .select("id, label, is_primary")
      .eq("church_id", churchId)
      .eq("stripe_account_id", stripeAccountId)
      .maybeSingle(),
    admin.from("churches").select("stripe_account_id").eq("id", churchId).maybeSingle(),
  ]);
  if (rowError && !isMissingFundAccountSchema(rowError)) return { label: "Giving account", funds: [] };

  const isPrimary = row?.is_primary === true || church?.stripe_account_id === stripeAccountId;
  let query = admin.from("giving_funds").select("name").eq("church_id", churchId).eq("is_active", true);
  if (isPrimary) {
    query = row?.id
      ? query.or(`giving_stripe_account_id.is.null,giving_stripe_account_id.eq.${row.id}`)
      : query.is("giving_stripe_account_id", null);
  } else if (row?.id) {
    query = query.eq("giving_stripe_account_id", row.id);
  } else {
    return { label: "Giving account", funds: [] };
  }
  const { data: funds } = await query.order("sort_order", { ascending: true });
  return {
    label: (row?.label as string | undefined) ?? (isPrimary ? "Main account" : "Giving account"),
    funds: (funds ?? []).map((f) => f.name as string),
  };
}

export type FundAccountAlert =
  | { kind: "payout_failed"; amountCents: number; currency: string; failureCode: string | null }
  | { kind: "requirements_due"; requirementsCount: number }
  | { kind: "disconnected" }
  | { kind: "dispute_opened"; amountCents: number; currency: string };

function money(cents: number, currency: string): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
    cents / 100,
  );
}

/**
 * Emails every admin of the church. Best effort: an alert that cannot be sent
 * never fails the webhook that recorded the underlying state, which the Funds
 * & Banks page shows regardless. `eventId` makes a redelivered event send no
 * second email.
 */
export async function alertChurchAdminsAboutAccount(input: {
  churchId: string;
  stripeAccountId: string;
  eventId: string;
  alert: FundAccountAlert;
}): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: church } = await admin
      .from("churches")
      .select("name, logo_url, giving_primary_color, giving_accent_color")
      .eq("id", input.churchId)
      .maybeSingle();
    const churchName = (church?.name as string | undefined) ?? "Your church";
    const { label, funds } = await fundNamesForStripeAccount(input.churchId, input.stripeAccountId);
    const fundText = funds.length ? funds.join(", ") : label;

    const members = await getChurchTeamMembers(input.churchId);
    const recipients = members
      .filter((m) => m.role === "admin" && m.email)
      .map((m) => m.email as string);
    if (!recipients.length) return;

    const actionUrl = `${getSiteUrl()}/dashboard/giving/funds`;
    const copy = alertCopy(input.alert, fundText);

    await Promise.all(
      recipients.map((to, index) =>
        sendGivingAdminAlertEmail({
          to,
          churchName,
          logoUrl: (church?.logo_url as string | null) ?? null,
          primaryColor: (church?.giving_primary_color as string | null) ?? null,
          accentColor: (church?.giving_accent_color as string | null) ?? null,
          subject: copy.subject,
          heading: copy.heading,
          paragraphs: copy.paragraphs,
          details: [{ label: "Funds", value: fundText }, ...copy.details],
          actionLabel: "Open Funds & Banks",
          actionUrl,
          idempotencyKey: `giving-alert/${input.eventId}/${index}`,
        }),
      ),
    );
  } catch {
    console.warn("[giving] account alert not sent", {
      account: input.stripeAccountId,
      kind: input.alert.kind,
    });
  }
}

function alertCopy(alert: FundAccountAlert, fundText: string) {
  switch (alert.kind) {
    case "payout_failed":
      return {
        subject: `A payout for ${fundText} did not reach the bank`,
        heading: "A payout failed",
        paragraphs: [
          `Stripe could not send ${money(alert.amountCents, alert.currency)} to the bank account for ${fundText}. This usually means the bank details for that fund are wrong or the account was closed.`,
          "Open Funds & Banks, then update the bank account for this fund in Stripe. The money stays in Stripe until the payout succeeds.",
        ],
        details: alert.failureCode ? [{ label: "Reason code", value: alert.failureCode }] : [],
      };
    case "requirements_due":
      return {
        subject: `Stripe needs information for ${fundText}`,
        heading: "Stripe needs more information",
        paragraphs: [
          `Stripe is asking for ${alert.requirementsCount === 1 ? "one item" : `${alert.requirementsCount} items`} on the account for ${fundText}. If it is not provided, gifts or payouts for these funds may be paused.`,
        ],
        details: [],
      };
    case "disconnected":
      return {
        subject: `The giving account for ${fundText} was disconnected`,
        heading: "A giving account was disconnected",
        paragraphs: [
          `The Stripe account for ${fundText} is no longer connected to FaithForm, so these funds are hidden from your giving page.`,
          "Reconnect it from Funds & Banks to start taking gifts for these funds again.",
        ],
        details: [],
      };
    case "dispute_opened":
      return {
        subject: `A gift to ${fundText} is being disputed`,
        heading: "A donor's bank disputed a gift",
        paragraphs: [
          `A ${money(alert.amountCents, alert.currency)} gift to ${fundText} is being disputed. The amount is held from that fund's Stripe balance until the dispute is settled.`,
          "Respond to the dispute in Stripe. Stripe sets a deadline for a response.",
        ],
        details: [],
      };
  }
}
