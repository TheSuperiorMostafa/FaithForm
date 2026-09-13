import { getGivePageUrl } from "@/lib/site-url";

/**
 * How a phone may take a gift for one church.
 *
 * ## Why iPhone needs to be told
 *
 * Apple's App Review Guideline 3.2.1(vi) allows a donation inside a third-party
 * app without In-App Purchase only when it is paid with Apple Pay *and* the
 * nonprofit receiving it is one Apple has approved — in the US, one holding a
 * Candid Seal of Transparency. The recipient of every FaithForm gift is the
 * church (a direct charge on its own Stripe account), so approval is a fact
 * about each church, recorded by a platform admin in migration 0072's column.
 *
 * A church without it is still perfectly givable-to: the iPhone app opens its
 * public web give page in Safari, which is outside the app and outside the
 * rule. Android has no equivalent restriction and may ignore the flag.
 *
 * ## Why this is its own module
 *
 * It is the one decision in the giving surface that has no database or Stripe
 * call in it, so it is kept where a test can reach it without either.
 */
export type GivingChannels = {
  /** Whether the iPhone app may take this church's gifts with Apple Pay in-app. */
  applePayApproved: boolean;
  /**
   * The church's public give page, absolute, for opening in the browser.
   *
   * Built by the same helper the dashboard and QR code use, so the app and the
   * church's own printed link can never point at different places.
   */
  webGiveUrl: string | null;
};

/** What a church that cannot be given to right now reports: neither channel. */
export const NO_GIVING_CHANNELS: GivingChannels = Object.freeze({
  applePayApproved: false,
  webGiveUrl: null,
});

/**
 * The channels for a church that has already been resolved as able to accept
 * gifts. Pass `null` for any church that has not — a church that is not
 * accepting has no give page worth opening either, and an approval must never
 * read as "open for giving" on its own.
 */
export function givingChannelsFor(
  church: { slug: string; applePayDonationsApproved: boolean } | null,
): GivingChannels {
  if (!church) return { ...NO_GIVING_CHANNELS };

  return {
    // Strictly `true`: a missing or malformed value is "not approved", which
    // costs a giver one hop to Safari rather than costing FaithForm its listing.
    applePayApproved: church.applePayDonationsApproved === true,
    webGiveUrl: getGivePageUrl(church.slug),
  };
}
