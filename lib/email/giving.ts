import { getGivePageUrl, getSiteUrl } from "@/lib/stripe/config";

type FailedPaymentEmailParams = {
  donorEmail: string;
  donorName: string | null;
  churchName: string;
  churchSlug: string;
};

export async function sendFailedPaymentEmail(
  params: FailedPaymentEmailParams,
): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";
  const portalUrl = `${getSiteUrl()}/give/${params.churchSlug}/portal`;
  const greeting = params.donorName ? `Hi ${params.donorName}` : "Hello";

  const html = `
    <p>${greeting},</p>
    <p>Your recurring gift to <strong>${params.churchName}</strong> could not be processed.</p>
    <p>Please update your payment method to keep your gift active:</p>
    <p><a href="${portalUrl}">Update payment method</a></p>
    <p>Thank you for your generosity.</p>
  `;

  if (!apiKey) {
    console.log("[giving-email] failed payment (no RESEND_API_KEY):", portalUrl);
    return { sent: false };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: params.donorEmail,
      subject: `Action needed: update your gift to ${params.churchName}`,
      html,
    }),
  });

  if (!res.ok) {
    console.error("[giving-email] Resend error:", await res.text());
    return { sent: false };
  }

  return { sent: true };
}

type PortalMagicLinkParams = {
  donorEmail: string;
  churchName: string;
  magicLink: string;
};

export async function sendPortalMagicLinkEmail(
  params: PortalMagicLinkParams,
): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "onboarding@resend.dev";

  const html = `
    <p>Sign in to manage your gifts to <strong>${params.churchName}</strong>:</p>
    <p><a href="${params.magicLink}">Open donor portal</a></p>
    <p>This link expires in 30 minutes. If you did not request this, you can ignore this email.</p>
  `;

  if (!apiKey) {
    console.log("[giving-email] portal link (no RESEND_API_KEY):", params.magicLink);
    return { sent: false };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: params.donorEmail,
      subject: `Sign in to ${params.churchName} donor portal`,
      html,
    }),
  });

  if (!res.ok) {
    console.error("[giving-email] Resend error:", await res.text());
    return { sent: false };
  }

  return { sent: true };
}
