type GiftAmounts = {
  amountCents: number;
  netAmountCents: number | null;
  intendedAmountCents: number | null;
  feeCovered: boolean;
};

export type GiftNet = { cents: number | null; estimated: boolean };

export function giftNetAfterFees(gift: GiftAmounts): GiftNet {
  if (gift.netAmountCents !== null) return { cents: gift.netAmountCents, estimated: false };
  if (gift.amountCents === 0) return { cents: 0, estimated: false };
  if (
    gift.feeCovered && gift.intendedAmountCents !== null &&
    gift.intendedAmountCents > 0 && gift.intendedAmountCents < gift.amountCents
  ) {
    return { cents: gift.intendedAmountCents, estimated: true };
  }
  return { cents: null, estimated: false };
}

export function totalNetAfterFees(gifts: GiftAmounts[]): GiftNet {
  let total = 0;
  let estimated = false;
  for (const gift of gifts) {
    const net = giftNetAfterFees(gift);
    if (net.cents === null) return net;
    total += net.cents;
    estimated ||= net.estimated;
  }
  return { cents: total, estimated };
}
