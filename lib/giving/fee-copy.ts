import { STRIPE_FEE_FIXED_CENTS, STRIPE_FEE_PERCENT } from "@/lib/giving/fees";

/**
 * What a church actually pays to receive a gift, said plainly.
 *
 * The old line ("donors pay 2.2% + $0.30 only") was wrong twice: the card fee
 * is taken out of each gift unless the donor ticks "cover the fees" on the
 * give page, and the 2.2% + 30¢ rate is the payment partner's nonprofit
 * discount, which a church has to apply for and be approved for. Until then
 * the standard card rate applies. The give page's "cover the fees" estimate
 * uses the nonprofit rate (lib/giving/fees.ts), so it can fall a little short
 * of the standard rate.
 */
export function nonprofitRateLabel(): string {
  const percent = Math.round(STRIPE_FEE_PERCENT * 1000) / 10;
  return `${percent}% + ${STRIPE_FEE_FIXED_CENTS}¢`;
}

export function feeExplanation(platformFeeCents: number): {
  summary: string;
  details: string[];
} {
  const platform =
    platformFeeCents > 0
      ? `FaithForm keeps $${(platformFeeCents / 100).toFixed(2)} of each gift.`
      : "FaithForm doesn't take any part of your gifts.";
  return {
    summary: `${platform} A small card processing fee comes out of each gift before it reaches your bank.`,
    details: [
      `The processing fee is the payment partner's standard card rate. Churches approved for its nonprofit discount pay ${nonprofitRateLabel()} per card gift.`,
      "On your giving page, donors can choose to add a little to cover the fee, so your church receives close to the full amount they meant to give.",
    ],
  };
}
