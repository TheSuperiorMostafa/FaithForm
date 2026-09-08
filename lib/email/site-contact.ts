import { Resend } from "resend";

import { resolveFromAddress } from "@/lib/email/sender";
import {
  renderEmail,
  type EmailBlock,
  type RenderedEmail,
} from "@/lib/email/layout";

/**
 * Delivery for the Visit-section contact form.
 *
 * Reply-To is the visitor, so a pastor can hit reply and be talking to the
 * person who filled the form rather than to a noreply address.
 */

export type SiteContactEmailParams = {
  churchName: string;
  recipient: string;
  name: string;
  email: string;
  phone?: string | null;
  message?: string | null;
  /** Where the form was submitted from, for context in the email body. */
  sourceUrl?: string | null;
};

function buildSiteContactEmail(
  params: SiteContactEmailParams,
): RenderedEmail {
  const details: EmailBlock[] = [
    { kind: "detail", label: "Name", value: params.name },
    { kind: "detail", label: "Email", value: params.email },
  ];
  if (params.phone) {
    details.push({ kind: "detail", label: "Phone", value: params.phone });
  }

  return renderEmail({
    title: `New website enquiry — ${params.churchName}`,
    preheader: `${params.name} filled in the contact form on your website.`,
    heading: "New website enquiry",
    blocks: [
      {
        kind: "paragraph",
        text: "Someone filled in the contact form on your website.",
      },
      ...details,
      ...(params.message
        ? ([
            { kind: "subheading", text: "Message" },
            { kind: "quote", text: params.message },
          ] as EmailBlock[])
        : []),
      {
        kind: "muted",
        text: `Reply to this email to answer ${params.name} directly.`,
      },
    ],
    footerNote: params.sourceUrl
      ? `Sent by FaithForm from ${params.sourceUrl}.`
      : "Sent by FaithForm.",
    permissionNote: `You received this because you handle enquiries for ${params.churchName}.`,
  });
}

/**
 * Returns whether the message actually went out. The caller has already stored
 * the submission, so a failure here is logged and reported rather than thrown --
 * losing the lead would be worse than a missed notification.
 */
export async function sendSiteContactEmail(
  params: SiteContactEmailParams,
): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = resolveFromAddress();

  if (!apiKey) {
    console.log(
      `[FaithForm] Site contact for ${params.churchName} stored but not emailed (no RESEND_API_KEY)`,
    );
    return { sent: false };
  }

  const content = buildSiteContactEmail(params);

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: `FaithForm <${from}>`,
      to: params.recipient,
      replyTo: params.email,
      subject: `New website enquiry from ${params.name}`,
      html: content.html,
      text: content.text,
    });

    if (error) {
      console.error("[FaithForm] Site contact Resend error:", error);
      return { sent: false };
    }

    return { sent: true };
  } catch (error) {
    console.error("[FaithForm] Site contact send failed:", error);
    return { sent: false };
  }
}
