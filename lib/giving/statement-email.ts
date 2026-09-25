import { renderEmail, type EmailBrand } from "@/lib/email/layout";
import { resolveFromAddress } from "@/lib/email/sender";
import { isValidHexColor } from "@/lib/giving/branding";
import { getSiteUrl } from "@/lib/stripe/config";

/**
 * Emails one donor their year-end giving statement, with the PDF attached.
 *
 * Uses the same email provider (Resend) and the same church-branded layout as
 * donation receipts (lib/email/giving.ts): the statement is the church's
 * document, so it comes from the church's name and carries its colours.
 *
 * Returns `{ sent: false }` rather than throwing, so a batch can carry on and
 * report which donors didn't get theirs.
 */

const DEFAULT_PRIMARY = "#002D5F";
const DEFAULT_ACCENT = "#C5A059";

export function isStatementEmailConfigured(): boolean {
  return Boolean(process.env.RESEND_API_KEY?.trim());
}

export type StatementEmailInput = {
  donorEmail: string;
  donorName: string | null;
  churchName: string;
  churchSlug: string | null;
  primaryColor: string | null;
  accentColor: string | null;
  logoUrl: string | null;
  year: number;
  totalCents: number;
  giftCount: number;
  pdf: Buffer;
  /** Stops a retried request from sending the same email twice. */
  idempotencyKey: string;
};

function money(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function brand(input: StatementEmailInput): EmailBrand {
  return {
    name: input.churchName,
    primary:
      input.primaryColor && isValidHexColor(input.primaryColor) ? input.primaryColor : DEFAULT_PRIMARY,
    accent:
      input.accentColor && isValidHexColor(input.accentColor) ? input.accentColor : DEFAULT_ACCENT,
    logoUrl: input.logoUrl,
  };
}

export function statementEmailContent(input: StatementEmailInput) {
  const greeting = input.donorName?.trim() ? `Hi ${input.donorName.trim()},` : "Hello,";
  const portalUrl = input.churchSlug ? `${getSiteUrl()}/give/${input.churchSlug}/portal` : null;
  const content = renderEmail({
    brand: brand(input),
    title: `Your ${input.year} giving statement from ${input.churchName}`,
    preheader: `Your ${input.year} giving statement is attached. Keep it for your records.`,
    heading: `Your ${input.year} giving statement`,
    blocks: [
      { kind: "paragraph", text: greeting },
      {
        kind: "paragraph",
        text: `Thank you for your generosity to ${input.churchName} in ${input.year}. Your giving statement is attached as a PDF.`,
      },
      {
        kind: "callout",
        title: `Your giving in ${input.year}`,
        rows: [
          { label: "Total", value: money(input.totalCents) },
          { label: "Gifts", value: String(input.giftCount) },
        ],
      },
      {
        kind: "muted",
        text: "Please keep this statement for your tax records.",
      },
      ...(portalUrl
        ? [{ kind: "button" as const, label: "See your gifts", url: portalUrl }]
        : []),
    ],
    footerNote: `Questions about your statement? Contact ${input.churchName} directly.`,
    permissionNote: `You received this because you gave to ${input.churchName} in ${input.year}.`,
  });
  return {
    subject: `Your ${input.year} giving statement from ${input.churchName}`,
    html: content.html,
    text: content.text,
  };
}

export async function sendStatementEmail(
  input: StatementEmailInput,
  fetchImpl: typeof fetch = fetch,
): Promise<{ sent: boolean; rateLimited?: boolean }> {
  const apiKey = process.env.RESEND_API_KEY?.trim();
  if (!apiKey) return { sent: false };

  const content = statementEmailContent(input);
  try {
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey,
      },
      body: JSON.stringify({
        from: `${input.churchName} <${resolveFromAddress()}>`,
        to: input.donorEmail,
        subject: content.subject,
        html: content.html,
        text: content.text,
        attachments: [
          {
            filename: `giving-statement-${input.year}.pdf`,
            content: input.pdf.toString("base64"),
          },
        ],
      }),
    });
    if (!res.ok) {
      console.error("[giving-statement-email] provider delivery failed", res.status);
      return { sent: false, rateLimited: res.status === 429 };
    }
    return { sent: true };
  } catch (error) {
    console.error("[giving-statement-email] provider unreachable", error);
    return { sent: false };
  }
}
