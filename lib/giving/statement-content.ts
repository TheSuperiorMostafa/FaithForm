import type { GivingDonationRow } from "@/types/giving";

export function statementAcknowledgment(churchName: string, ein: string | null): string {
  const organization = ein?.trim()
    ? `${churchName} (EIN ${ein.trim()}) is a tax-exempt organization under Section 501(c)(3). `
    : "";
  return `${organization}No goods or services were provided in exchange for the contributions listed above, other than intangible religious benefits. Please retain this statement for your tax records. Consult your tax advisor regarding deductibility.`;
}

/** Sum received gifts in integer cents, grouping by fund identity rather than its display name. */
export function statementFundTotals(gifts: GivingDonationRow[]) {
  const totals = new Map<string, { name: string; amountCents: number }>();
  for (const gift of gifts) {
    const name = gift.fundName || gift.fundDesignation || "General";
    const key = gift.fundId ?? name;
    const current = totals.get(key);
    totals.set(key, { name, amountCents: (current?.amountCents ?? 0) + gift.amountCents });
  }
  return [...totals.values()].sort((a, b) => a.name.localeCompare(b.name));
}
