/** Stripe nonprofit card rate: 2.2% + $0.30 */
export const STRIPE_FEE_PERCENT = 0.022;
export const STRIPE_FEE_FIXED_CENTS = 30;

/** Gross-up charge so church nets `intendedCents` after Stripe fees. */
export function chargeCentsWithFeeCoverage(intendedCents: number): number {
  return Math.ceil((intendedCents + STRIPE_FEE_FIXED_CENTS) / (1 - STRIPE_FEE_PERCENT));
}

export function feeCoverageAmountCents(intendedCents: number): number {
  return chargeCentsWithFeeCoverage(intendedCents) - intendedCents;
}
