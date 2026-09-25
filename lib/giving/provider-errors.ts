/**
 * Payment-provider failures, in words a treasurer can act on.
 *
 * The refund and recurring-gift routes used to return the provider's own
 * error text ("No such charge: 'ch_…'", "This PaymentIntent does not have a
 * successful charge to refund"). The detail still goes to the server log; the
 * person gets what happened and what to do next.
 */

type ProviderErrorLike = {
  code?: unknown;
  type?: unknown;
  statusCode?: unknown;
  message?: unknown;
};

function codeOf(error: unknown): string {
  if (!error || typeof error !== "object") return "";
  const code = (error as ProviderErrorLike).code;
  return typeof code === "string" ? code : "";
}

function isConnectionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const type = (error as ProviderErrorLike).type;
  return type === "StripeConnectionError" || type === "StripeAPIError";
}

const SUPPORT = "If it keeps happening, contact FaithForm support.";

export function refundErrorMessage(error: unknown): string {
  const code = codeOf(error);
  if (code === "charge_already_refunded") {
    return "This gift has already been refunded. It will show as Refunded shortly.";
  }
  if (code === "charge_disputed") {
    return "This gift is being questioned by the donor's bank, so it can't be refunded here. The bank will decide the outcome.";
  }
  if (code === "balance_insufficient" || code === "insufficient_funds") {
    return "There isn't enough in your church's giving balance to cover this refund yet. Try again after more gifts come in.";
  }
  if (isConnectionError(error)) {
    return `We couldn't reach our payment partner. Nothing was refunded. Try again in a minute. ${SUPPORT}`;
  }
  return `We couldn't refund this gift. Nothing was refunded. Try again, and ${SUPPORT.charAt(0).toLowerCase()}${SUPPORT.slice(1)}`;
}

export type RecurringAction = "pause" | "resume" | "cancel";

export function recurringErrorMessage(action: RecurringAction, error: unknown): string {
  const code = codeOf(error);
  if (code === "resource_missing") {
    return "We couldn't find this recurring gift any more. It may already have been cancelled. Refresh the page to see its latest state.";
  }
  if (isConnectionError(error)) {
    return `We couldn't reach our payment partner. Nothing was changed. Try again in a minute. ${SUPPORT}`;
  }
  const verb = action === "pause" ? "pause" : action === "resume" ? "resume" : "cancel";
  return `We couldn't ${verb} this recurring gift. Nothing was changed. Try again, and ${SUPPORT.charAt(0).toLowerCase()}${SUPPORT.slice(1)}`;
}
