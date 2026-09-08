import { getSiteUrl } from "@/lib/stripe/config";
import { isValidHexColor } from "@/lib/giving/branding";
import {
  renderEmail,
  type EmailBrand,
} from "@/lib/email/layout";
import { resolveFromAddress } from "@/lib/email/sender";

const DEFAULT_PRIMARY = "#002D5F";
const DEFAULT_ACCENT = "#C5A059";

function resolveColor(
  value: string | null | undefined,
  fallback: string,
): string {
  return value && isValidHexColor(value) ? value : fallback;
}

/**
 * A donation receipt is the church's document, not ours. The header carries
 * their name, their colours and their logo, and FaithForm appears nowhere in
 * the body — the donor gave to a church, and the paperwork should say so.
 */
function churchBrand(params: {
  churchName: string;
  primaryColor?: string | null;
  accentColor?: string | null;
  logoUrl?: string | null;
}): EmailBrand {
  return {
    name: params.churchName,
    primary: resolveColor(params.primaryColor, DEFAULT_PRIMARY),
    accent: resolveColor(params.accentColor, DEFAULT_ACCENT),
    // The layout drops anything that is not an absolute https URL.
    logoUrl: params.logoUrl ?? null,
  };
}

async function sendResendEmail(params: {
  to: string;
  fromName: string;
  subject: string;
  html: string;
  text: string;
  logLabel: string;
  idempotencyKey?: string;
}): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  const from = resolveFromAddress();

  if (!apiKey) {
    console.info(`[giving-email] ${params.logLabel} unavailable`);
    return { sent: false };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      ...(params.idempotencyKey
        ? { "Idempotency-Key": params.idempotencyKey }
        : {}),
    },
    body: JSON.stringify({
      from: `${params.fromName} <${from}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  if (!res.ok) {
    console.error("[giving-email] provider delivery failed", res.status);
    return { sent: false };
  }

  return { sent: true };
}

type ChurchEmailBranding = {
  churchName: string;
  primaryColor?: string | null;
  accentColor?: string | null;
  /** Absolute https URL to the church's uploaded logo, when it has one. */
  logoUrl?: string | null;
};

type FailedPaymentEmailParams = ChurchEmailBranding & {
  donorEmail: string;
  donorName: string | null;
  churchSlug: string;
  idempotencyKey: string;
};

export async function sendFailedPaymentEmail(
  params: FailedPaymentEmailParams,
): Promise<{ sent: boolean }> {
  const portalUrl = `${getSiteUrl()}/give/${params.churchSlug}/portal`;
  const greeting = params.donorName ? `Hi ${params.donorName},` : "Hello,";

  const content = renderEmail({
    brand: churchBrand(params),
    title: `Update your gift to ${params.churchName}`,
    preheader: "Your recurring gift could not be processed.",
    heading: "Your recurring gift needs attention",
    blocks: [
      { kind: "paragraph", text: greeting },
      {
        kind: "paragraph",
        text: `Your recurring gift to ${params.churchName} could not be processed. Please update your payment method to keep your gift active.`,
      },
      { kind: "button", label: "Open donor portal", url: portalUrl },
    ],
    footerNote: "Thank you for your generosity.",
    permissionNote: `You received this because you give to ${params.churchName}.`,
  });

  return sendResendEmail({
    to: params.donorEmail,
    fromName: params.churchName,
    subject: `Action needed: update your gift to ${params.churchName}`,
    html: content.html,
    text: content.text,
    logLabel: `failed payment → ${portalUrl}`,
    idempotencyKey: params.idempotencyKey,
  });
}

type PortalMagicLinkParams = ChurchEmailBranding & {
  donorEmail: string;
  magicLink: string;
  isNewDonor: boolean;
};

export async function sendPortalMagicLinkEmail(
  params: PortalMagicLinkParams,
): Promise<{ sent: boolean }> {
  const content = renderEmail({
    brand: churchBrand(params),
    title: params.isNewDonor
      ? `Create your donor account at ${params.churchName}`
      : `Sign in to give to ${params.churchName}`,
    preheader: "Your sign-in link — it expires in 30 minutes.",
    heading: params.isNewDonor
      ? "Set up your donor account"
      : "Your sign-in link",
    blocks: [
      {
        kind: "paragraph",
        text: params.isNewDonor
          ? `Welcome! Use the button below to set up your donor account and manage gifts to ${params.churchName}.`
          : `Use the button below to sign in and manage your gifts to ${params.churchName}.`,
      },
      {
        kind: "paragraph",
        text: "You can give again, manage recurring gifts, update your card, and download tax statements.",
      },
      {
        kind: "button",
        label: params.isNewDonor ? "Create your account" : "Open donor portal",
        url: params.magicLink,
      },
      {
        kind: "muted",
        text: "This link expires in 30 minutes. If you did not request it, you can ignore this email.",
      },
    ],
    footerNote: `Questions? Contact ${params.churchName} directly.`,
    permissionNote: `You received this because you asked to sign in to ${params.churchName}'s giving portal.`,
  });

  const subject = params.isNewDonor
    ? `Create your donor account at ${params.churchName}`
    : `${params.churchName} Giving — sign in`;

  return sendResendEmail({
    to: params.donorEmail,
    fromName: params.churchName,
    subject,
    html: content.html,
    text: content.text,
    logLabel: "portal-link",
  });
}

export type DonationReceiptEmailParams = ChurchEmailBranding & {
  donorEmail: string;
  donorName: string | null;
  churchSlug: string;
  ein: string | null;
  amountCents: number;
  fundName: string | null;
  giftType: "one_time" | "recurring";
  giftDate: string;
  idempotencyKey?: string;
};

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function sendDonationReceiptEmail(
  params: DonationReceiptEmailParams,
): Promise<{ sent: boolean }> {
  const portalUrl = `${getSiteUrl()}/give/${params.churchSlug}/portal`;
  const greeting = params.donorName ? `Hi ${params.donorName},` : "Hello,";
  const giftTypeLabel =
    params.giftType === "recurring" ? "Recurring gift" : "One-time gift";

  const content = renderEmail({
    brand: churchBrand(params),
    title: `Receipt for your gift to ${params.churchName}`,
    preheader: `${formatMoney(params.amountCents)} on ${params.giftDate} — keep this for your tax records.`,
    heading: "Thank you for your gift",
    blocks: [
      { kind: "paragraph", text: greeting },
      {
        kind: "paragraph",
        text: `Thank you for your gift to ${params.churchName}. Here is your receipt for your records.`,
      },
      {
        kind: "callout",
        title: "Your gift",
        rows: [
          { label: "Amount", value: formatMoney(params.amountCents) },
          { label: "Date", value: params.giftDate },
          { label: "Fund", value: params.fundName ?? "General" },
          { label: "Type", value: giftTypeLabel },
          ...(params.ein ? [{ label: "EIN", value: params.ein }] : []),
        ],
      },
      {
        kind: "muted",
        text: "No goods or services were provided in exchange for this contribution. Please retain this receipt for your tax records.",
      },
      { kind: "button", label: "Manage your gifts", url: portalUrl },
    ],
    footerNote: `Questions about your gift? Contact ${params.churchName} directly.`,
    permissionNote: `You received this because you gave to ${params.churchName}.`,
  });

  return sendResendEmail({
    to: params.donorEmail,
    fromName: params.churchName,
    subject: `Receipt for your gift to ${params.churchName}`,
    html: content.html,
    text: content.text,
    logLabel: "donation-receipt",
    idempotencyKey: params.idempotencyKey,
  });
}
