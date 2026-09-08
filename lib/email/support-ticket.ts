import { Resend } from "resend";

import { absoluteAppPath } from "@/lib/site-url";
import {
  renderEmail,
  type EmailBlock,
  type RenderedEmail,
} from "@/lib/email/layout";

/**
 * Every piece of mail a support ticket generates.
 *
 * Three notes leave here, all on the same address so a church only ever sees
 * one mailbox for help:
 *
 *   1. To us — a church raised a ticket. Nobody sits refreshing the control
 *      center, so the queue gets a doorbell.
 *   2. To them — we have it. A church that files a ticket into silence has no
 *      way to tell a saved ticket from a lost one.
 *   3. To them again — we replied. The reply is on the dashboard either way;
 *      the mail is what makes them look.
 *
 * Failure is swallowed throughout. The ticket row is committed before any of
 * this runs, and a Resend outage must never turn a saved ticket into an error
 * the church sees.
 */

/** The one mailbox support runs on, in both directions. */
export const SUPPORT_EMAIL = "support@faithform.io";

function supportFromAddress(): string {
  const configured = process.env.SUPPORT_FROM_EMAIL?.trim();
  return `FaithForm Support <${configured || SUPPORT_EMAIL}>`;
}

/**
 * Recipients are the platform's own inbox, never a value from the ticket — the
 * form is church-supplied input and must not be able to address our mail.
 */
function internalRecipients(): string[] {
  const configured = process.env.SUPPORT_NOTIFY_EMAIL?.trim();
  if (configured) {
    return configured
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return [SUPPORT_EMAIL];
}

function resendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  return apiKey ? new Resend(apiKey) : null;
}

async function send(params: {
  to: string[];
  subject: string;
  content: RenderedEmail;
  replyTo?: string;
  /** Names this message in logs when it cannot be sent. */
  label: string;
}): Promise<boolean> {
  const resend = resendClient();
  if (!resend || params.to.length === 0) {
    console.log(`[FaithForm] ${params.label} not sent — email is not configured.`);
    return false;
  }

  try {
    const { error } = await resend.emails.send({
      from: supportFromAddress(),
      to: params.to,
      replyTo: params.replyTo ?? SUPPORT_EMAIL,
      subject: params.subject,
      html: params.content.html,
      text: params.content.text,
    });
    if (error) {
      console.error(`[FaithForm] ${params.label} Resend error:`, error);
      return false;
    }
    return true;
  } catch (error) {
    console.error(`[FaithForm] ${params.label} failed:`, error);
    return false;
  }
}

export type SupportTicketEmailParams = {
  churchName: string;
  subject: string;
  body: string | null;
  submittedByEmail: string | null;
  priority: string;
  /** Deep link to the ticket in the control center. */
  reviewUrl: string;
};

/** Doorbell for our own queue. */
export async function sendSupportTicketNotification(
  params: SupportTicketEmailParams,
): Promise<{ emailed: boolean }> {
  const content = renderEmail({
    title: `Support — ${params.churchName}: ${params.subject}`,
    preheader: `${params.priority} priority ticket from ${params.churchName}.`,
    heading: params.subject,
    blocks: [
      { kind: "detail", label: "Church", value: params.churchName },
      ...(params.submittedByEmail
        ? ([{ kind: "detail", label: "From", value: params.submittedByEmail }] as EmailBlock[])
        : []),
      { kind: "detail", label: "Priority", value: params.priority },
      { kind: "subheading", text: "What they sent" },
      { kind: "quote", text: params.body ?? "No details given." },
      { kind: "button", label: "Open the ticket", url: params.reviewUrl },
    ],
    footerNote: "FaithForm control center",
    permissionNote: "You received this because you handle FaithForm support.",
  });

  const emailed = await send({
    to: internalRecipients(),
    // Replying to the notification should reach the church, not our own inbox.
    replyTo: params.submittedByEmail ?? SUPPORT_EMAIL,
    subject: `Support — ${params.churchName}: ${params.subject}`,
    content,
    label: "Support ticket notification",
  });

  return { emailed };
}

export type SupportTicketAckParams = {
  to: string;
  churchName: string;
  subject: string;
  body: string | null;
};

/**
 * Sent to the church the moment their ticket lands. It promises nothing about
 * timing — it only confirms the thing arrived and says where to watch it.
 */
export async function sendSupportTicketAck(
  params: SupportTicketAckParams,
): Promise<boolean> {
  const content = renderEmail({
    title: `We received your request — ${params.subject}`,
    preheader: "Your support request is with the FaithForm team.",
    heading: "We've got your request",
    blocks: [
      {
        kind: "paragraph",
        text: "Thanks for reaching out. Your support request is with the FaithForm team, and we'll reply by email as soon as we've looked at it. You can follow the conversation from your dashboard at any time.",
      },
      { kind: "subheading", text: "What you sent us" },
      { kind: "paragraph", text: params.subject },
      { kind: "quote", text: params.body ?? "No details given." },
      {
        kind: "button",
        label: "View your tickets",
        url: absoluteAppPath("/dashboard/support"),
      },
      { kind: "muted", text: "Need to add something? Just reply to this email." },
    ],
    permissionNote: `You received this because you raised a support request for ${params.churchName}.`,
  });

  return send({
    to: [params.to],
    subject: `We received your request — ${params.subject}`,
    content,
    label: "Support ticket acknowledgement",
  });
}

export type SupportTicketReplyParams = {
  to: string;
  subject: string;
  message: string;
  /** The ticket's status after this reply, spelled for a reader. */
  statusLabel: string;
};

/**
 * Sent to the church when we post a comment on their ticket. The comment text
 * is ours, not church-supplied, but it is escaped like everything else.
 */
export async function sendSupportTicketReply(
  params: SupportTicketReplyParams,
): Promise<boolean> {
  const content = renderEmail({
    title: `Re: ${params.subject}`,
    preheader: "We replied to your support request.",
    heading: "FaithForm replied to your request",
    blocks: [
      { kind: "detail", label: "Request", value: params.subject },
      { kind: "detail", label: "Status", value: params.statusLabel },
      { kind: "quote", text: params.message },
      {
        kind: "button",
        label: "Open the conversation",
        url: absoluteAppPath("/dashboard/support"),
      },
      { kind: "muted", text: "Reply to this email to get back to us." },
    ],
    permissionNote: "You received this because you raised a support request with FaithForm.",
  });

  return send({
    to: [params.to],
    subject: `Re: ${params.subject}`,
    content,
    label: "Support ticket reply",
  });
}
