import {
  getCanonicalSiteUrl,
  getGivePageUrl,
} from "@/lib/site-url";

/** Platform application fee in cents (0 at launch). */
export function applicationFeeAmount(): number {
  const raw = process.env.PLATFORM_APPLICATION_FEE_AMOUNT ?? "0";
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export const STRIPE_NONPROFIT_RATE_LABEL = "2.2% + $0.30 (Stripe nonprofit rate)";

/** @deprecated Use getCanonicalSiteUrl from @/lib/site-url */
export function getSiteUrl(): string {
  return getCanonicalSiteUrl();
}

export { getGivePageUrl };
