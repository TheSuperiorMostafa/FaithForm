import { getSiteUrl } from "@/lib/stripe/config";

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function buildGivingEmailHtml(params: {
  heading: string;
  bodyHtml: string;
  ctaLabel: string;
  ctaUrl: string;
  footerNote: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background-color:#F8F7F4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8F7F4;padding:40px 20px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,45,95,0.08);">
          <tr>
            <td style="background-color:#002D5F;padding:32px 40px;text-align:center;">
              <span style="font-family:Georgia,serif;font-size:28px;font-weight:700;color:#ffffff;letter-spacing:-0.5px;">FaithForm</span>
            </td>
          </tr>
          <tr>
            <td style="padding:40px;">
              <h1 style="margin:0 0 20px;font-size:24px;font-weight:700;color:#002D5F;line-height:1.3;">
                ${escapeHtml(params.heading)}
              </h1>
              ${params.bodyHtml}
              <table cellpadding="0" cellspacing="0" style="margin:24px 0 32px;">
                <tr>
                  <td style="background-color:#C5A059;border-radius:10px;">
                    <a href="${params.ctaUrl}" style="display:inline-block;padding:16px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">
                      ${escapeHtml(params.ctaLabel)}
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 12px;font-size:14px;color:#9CA3AF;line-height:1.5;">
                ${escapeHtml(params.footerNote)}
              </p>
              <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.5;word-break:break-all;">
                Or copy this link: ${params.ctaUrl}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

async function sendResendEmail(params: {
  to: string;
  subject: string;
  html: string;
  logLabel: string;
}): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "noreply@faithform.io";

  if (!apiKey) {
    console.log(`[giving-email] ${params.logLabel} (no RESEND_API_KEY)`);
    return { sent: false };
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: `FaithForm <${from}>`,
      to: params.to,
      subject: params.subject,
      html: params.html,
    }),
  });

  if (!res.ok) {
    console.error("[giving-email] Resend error:", await res.text());
    return { sent: false };
  }

  return { sent: true };
}

type FailedPaymentEmailParams = {
  donorEmail: string;
  donorName: string | null;
  churchName: string;
  churchSlug: string;
};

export async function sendFailedPaymentEmail(
  params: FailedPaymentEmailParams,
): Promise<{ sent: boolean }> {
  const portalUrl = `${getSiteUrl()}/give/${params.churchSlug}/portal`;
  const greeting = params.donorName ? `Hi ${escapeHtml(params.donorName)}` : "Hello";

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">${greeting},</p>
    <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">
      Your recurring gift to <strong>${escapeHtml(params.churchName)}</strong> could not be processed.
      Please update your payment method to keep your gift active.
    </p>
  `;

  const html = buildGivingEmailHtml({
    heading: "Update your payment method",
    bodyHtml,
    ctaLabel: "Open donor portal",
    ctaUrl: portalUrl,
    footerNote: "Thank you for your generosity.",
  });

  return sendResendEmail({
    to: params.donorEmail,
    subject: `Action needed: update your gift to ${params.churchName}`,
    html,
    logLabel: `failed payment → ${portalUrl}`,
  });
}

type PortalMagicLinkParams = {
  donorEmail: string;
  churchName: string;
  magicLink: string;
  isNewDonor: boolean;
};

export async function sendPortalMagicLinkEmail(
  params: PortalMagicLinkParams,
): Promise<{ sent: boolean }> {
  const heading = params.isNewDonor
    ? `Create your account at ${params.churchName}`
    : `Sign in to ${params.churchName}`;

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">
      ${
        params.isNewDonor
          ? `Welcome! Use the button below to set up your donor account and manage gifts to <strong>${escapeHtml(params.churchName)}</strong>.`
          : `Use the button below to sign in and manage your gifts to <strong>${escapeHtml(params.churchName)}</strong>.`
      }
    </p>
    <p style="margin:0;font-size:16px;color:#374151;line-height:1.6;">
      You can give again, manage recurring gifts, update your card, and download tax statements.
    </p>
  `;

  const html = buildGivingEmailHtml({
    heading,
    bodyHtml,
    ctaLabel: params.isNewDonor ? "Create your account" : "Open donor portal",
    ctaUrl: params.magicLink,
    footerNote:
      "This link expires in 30 minutes. If you did not request this, you can ignore this email.",
  });

  const subject = params.isNewDonor
    ? `Create your donor account at ${params.churchName}`
    : `Sign in to ${params.churchName} donor portal`;

  return sendResendEmail({
    to: params.donorEmail,
    subject,
    html,
    logLabel: `portal link → ${params.magicLink}`,
  });
}

export type DonationReceiptEmailParams = {
  donorEmail: string;
  donorName: string | null;
  churchName: string;
  churchSlug: string;
  ein: string | null;
  amountCents: number;
  fundName: string | null;
  giftType: "one_time" | "recurring";
  giftDate: string;
};

function formatMoney(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export async function sendDonationReceiptEmail(
  params: DonationReceiptEmailParams,
): Promise<{ sent: boolean }> {
  const portalUrl = `${getSiteUrl()}/give/${params.churchSlug}/portal`;
  const greeting = params.donorName
    ? `Hi ${escapeHtml(params.donorName)}`
    : "Hello";
  const giftTypeLabel =
    params.giftType === "recurring" ? "Recurring gift" : "One-time gift";
  const einLine = params.ein
    ? `<p style="margin:0 0 16px;font-size:14px;color:#6B7280;line-height:1.5;">EIN: ${escapeHtml(params.ein)}</p>`
    : "";

  const bodyHtml = `
    <p style="margin:0 0 16px;font-size:16px;color:#374151;line-height:1.6;">${greeting},</p>
    <p style="margin:0 0 24px;font-size:16px;color:#374151;line-height:1.6;">
      Thank you for your gift to <strong>${escapeHtml(params.churchName)}</strong>.
      Here is your receipt for your records.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 24px;background:#F9FAFB;border-radius:8px;padding:20px;">
      <tr>
        <td style="padding:20px;">
          <p style="margin:0 0 8px;font-size:14px;color:#6B7280;">Amount</p>
          <p style="margin:0 0 16px;font-size:20px;font-weight:700;color:#002D5F;">${formatMoney(params.amountCents)}</p>
          <p style="margin:0 0 8px;font-size:14px;color:#6B7280;">Date</p>
          <p style="margin:0 0 16px;font-size:16px;color:#374151;">${escapeHtml(params.giftDate)}</p>
          <p style="margin:0 0 8px;font-size:14px;color:#6B7280;">Fund</p>
          <p style="margin:0 0 16px;font-size:16px;color:#374151;">${escapeHtml(params.fundName ?? "General")}</p>
          <p style="margin:0 0 8px;font-size:14px;color:#6B7280;">Type</p>
          <p style="margin:0;font-size:16px;color:#374151;">${giftTypeLabel}</p>
        </td>
      </tr>
    </table>
    ${einLine}
    <p style="margin:0;font-size:14px;color:#6B7280;line-height:1.5;">
      No goods or services were provided in exchange for this contribution.
      Please retain this receipt for your tax records.
    </p>
  `;

  const html = buildGivingEmailHtml({
    heading: "Your giving receipt",
    bodyHtml,
    ctaLabel: "Manage your gifts",
    ctaUrl: portalUrl,
    footerNote: `Questions about your gift? Contact ${params.churchName} directly.`,
  });

  return sendResendEmail({
    to: params.donorEmail,
    subject: `Receipt for your gift to ${params.churchName}`,
    html,
    logLabel: `receipt → ${params.donorEmail}`,
  });
}
