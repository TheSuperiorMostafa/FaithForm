import type { StatusTone } from "@/components/ui/status-badge";
import type {
  DonationStatus,
  GiftType,
  GivingDonationRow,
  StripeOnboardingStatus,
  SubscriptionStatus,
} from "@/types/giving";

/**
 * Plain words for every giving state the dashboard shows.
 *
 * Raw values (`succeeded`, `past_due`, `in_transit`) come from the payment
 * provider and never reach the page: each one is mapped here, and anything we
 * don't recognise gets a neutral sentence rather than a capitalised enum.
 * See audit §8.4 for the canonical vocabularies.
 */
export type PlainStatus = { label: string; tone: StatusTone };

export function giftStatus(status: DonationStatus | string | null | undefined): PlainStatus {
  switch (status) {
    case "succeeded":
      return { label: "Received", tone: "done" };
    case "pending":
      return { label: "Pending", tone: "working" };
    case "refunded":
      return { label: "Refunded", tone: "neutral" };
    case "disputed":
      return { label: "Questioned by the bank", tone: "attention" };
    case "failed":
      return { label: "Failed", tone: "attention" };
    default:
      return { label: "Checking", tone: "neutral" };
  }
}

/** The status filter's options, in the order a treasurer looks for them. */
export const GIFT_STATUS_FILTERS: { value: DonationStatus; label: string }[] = [
  { value: "succeeded", label: "Received" },
  { value: "pending", label: "Pending" },
  { value: "refunded", label: "Refunded" },
  { value: "disputed", label: "Questioned by the bank" },
  { value: "failed", label: "Failed" },
];

export function giftTypeLabel(type: GiftType | string | null | undefined): string {
  if (type === "recurring") return "Recurring";
  if (type === "one_time") return "One-time";
  return "Gift";
}

/** Only a received gift can be refunded; the refund route refuses the rest. */
export function isRefundable(
  donation: Pick<GivingDonationRow, "status" | "stripePaymentIntentId">,
): boolean {
  return donation.status === "succeeded" && Boolean(donation.stripePaymentIntentId);
}

export function donorDisplayName(d: {
  donorName?: string | null;
  donorEmail?: string | null;
  name?: string | null;
  email?: string | null;
}): string {
  return (
    d.donorName?.trim() ||
    d.name?.trim() ||
    d.donorEmail?.trim() ||
    d.email?.trim() ||
    "Guest"
  );
}

// ---------------------------------------------------------------------------
// Recurring gifts
// ---------------------------------------------------------------------------

export type RecurringState = "active" | "paused" | "failed" | "cancelled" | "starting";

export function recurringState(
  status: SubscriptionStatus | string | null | undefined,
  pausedAt?: string | null,
): RecurringState {
  switch (status) {
    case "canceled":
    case "incomplete_expired":
      return "cancelled";
    case "past_due":
    case "unpaid":
      return "failed";
    case "paused":
      return "paused";
    case "incomplete":
      return "starting";
    default:
      return pausedAt ? "paused" : "active";
  }
}

export function recurringStatus(
  status: SubscriptionStatus | string | null | undefined,
  pausedAt?: string | null,
): PlainStatus {
  switch (recurringState(status, pausedAt)) {
    case "cancelled":
      return { label: "Cancelled", tone: "neutral" };
    case "failed":
      return { label: "Payment failed", tone: "attention" };
    case "paused":
      return { label: "Paused", tone: "working" };
    case "starting":
      return { label: "Starting", tone: "working" };
    default:
      return { label: "Active", tone: "done" };
  }
}

/** "Every week", never "weekly" built from the enum (which gave "dayly"). */
export function intervalLabel(interval: string | null | undefined): string {
  switch (interval) {
    case "day":
      return "Every day";
    case "week":
      return "Every week";
    case "month":
      return "Every month";
    case "year":
      return "Every year";
    default:
      return "Repeats";
  }
}

// ---------------------------------------------------------------------------
// Deposits (payouts to the church's bank)
// ---------------------------------------------------------------------------

export function depositStatus(status: string | null | undefined): PlainStatus {
  switch (status) {
    case "paid":
      return { label: "In your bank", tone: "done" };
    case "pending":
    case "in_transit":
      return { label: "On the way", tone: "working" };
    case "failed":
      return { label: "Failed", tone: "attention" };
    case "canceled":
      return { label: "Cancelled", tone: "neutral" };
    default:
      return { label: "Checking", tone: "neutral" };
  }
}

// ---------------------------------------------------------------------------
// Bank connection
// ---------------------------------------------------------------------------

export function connectionStatus(
  status: StripeOnboardingStatus | string | null | undefined,
  chargesEnabled: boolean,
): PlainStatus {
  if (chargesEnabled) return { label: "Accepting gifts", tone: "done" };
  switch (status) {
    case "restricted":
      return { label: "A few details needed", tone: "attention" };
    case "pending":
      return { label: "Being checked", tone: "working" };
    case "deauthorized":
      return { label: "Disconnected", tone: "attention" };
    default:
      return { label: "Not connected", tone: "neutral" };
  }
}

export const UNKNOWN_REQUIREMENT_TASK = "Finish a few details with Stripe";

/**
 * Turns the payment provider's requirement keys (`external_account`,
 * `individual.verification.document`, `company.address.line1`, …) into the
 * short list of jobs a pastor recognises. Order is kept, duplicates are
 * dropped, and anything we don't recognise becomes one plain fallback.
 */
export function requirementTasks(keys: readonly string[] | null | undefined): string[] {
  const tasks: string[] = [];
  const add = (task: string) => {
    if (!tasks.includes(task)) tasks.push(task);
  };
  for (const raw of keys ?? []) {
    const key = String(raw).trim().toLowerCase();
    if (!key) continue;
    add(requirementTask(key));
  }
  return tasks;
}

function requirementTask(key: string): string {
  if (key === "external_account" || key.startsWith("external_account.")) {
    return "Add your bank account";
  }
  if (key.startsWith("tos_acceptance")) return "Accept the payment terms";
  if (key === "business_type" || key === "business_profile.mcc") {
    return "Choose what kind of organization you are";
  }
  if (key.startsWith("company.verification")) return "Upload a document for your church";
  if (key === "company.tax_id" || key.startsWith("company.tax_id")) {
    return "Add your church's tax ID (EIN)";
  }
  if (key === "company.name" || key.startsWith("company.name")) {
    return "Add your church's legal name";
  }
  if (key.startsWith("company.address") || key.startsWith("business_profile.support_address")) {
    return "Add your church's address";
  }
  if (key.startsWith("company.phone") || key.startsWith("business_profile.support_phone")) {
    return "Add your church's phone number";
  }
  if (
    key.startsWith("business_profile.url") ||
    key.startsWith("business_profile.product_description")
  ) {
    return "Add your church's website or a short description";
  }
  if (
    key.startsWith("company.owners") ||
    key.startsWith("company.directors") ||
    key.startsWith("company.executives") ||
    key.startsWith("relationship.")
  ) {
    return "Add your church's leaders";
  }
  if (
    key.startsWith("individual.") ||
    key.startsWith("representative.") ||
    key.startsWith("person_") ||
    key.startsWith("owners.") ||
    key.startsWith("directors.") ||
    key.startsWith("executives.")
  ) {
    return "Confirm your identity";
  }
  return UNKNOWN_REQUIREMENT_TASK;
}
