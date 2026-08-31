import { Resend } from "resend";

import { escapeHtml } from "@/lib/email/escape-html";
import { absoluteAppPath } from "@/lib/site-url";

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
  html: string;
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
      html: params.html,
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

function shell(inner: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background-color:#F8F7F4;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color:#F8F7F4;padding:32px 16px;">
    <tr>
      <td align="center">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background-color:#FFFFFF;border-radius:14px;padding:32px;">
          <tr>
            <td>
${inner}
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function quoteBlock(body: string | null): string {
  const html = body
    ? escapeHtml(body).replace(/\n/g, "<br />")
    : "<em>No details given.</em>";
  return `<div style="font-size:15px;line-height:1.6;color:#002D5F;border-left:3px solid #C9A227;padding-left:14px;">${html}</div>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:26px 0 0;">
                <a href="${escapeHtml(href)}" style="display:inline-block;background-color:#002D5F;color:#FFFFFF;text-decoration:none;font-size:15px;padding:12px 22px;border-radius:8px;">
                  ${escapeHtml(label)}
                </a>
              </p>`;
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
  const inner = `<h1 style="margin:0 0 6px;font-size:20px;color:#002D5F;">
                ${escapeHtml(params.subject)}
              </h1>
              <p style="margin:0 0 22px;font-size:14px;color:#6B7280;">
                New support ticket from ${escapeHtml(params.churchName)}${
                  params.submittedByEmail
                    ? ` · ${escapeHtml(params.submittedByEmail)}`
                    : ""
                } · ${escapeHtml(params.priority)} priority
              </p>
              ${quoteBlock(params.body)}
              ${button(params.reviewUrl, "Open the ticket")}`;

  const emailed = await send({
    to: internalRecipients(),
    // Replying to the notification should reach the church, not our own inbox.
    replyTo: params.submittedByEmail ?? SUPPORT_EMAIL,
    subject: `Support — ${params.churchName}: ${params.subject}`,
    html: shell(inner),
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
  const inner = `<h1 style="margin:0 0 6px;font-size:20px;color:#002D5F;">
                We've got your request
              </h1>
              <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:#002D5F;">
                Thanks for reaching out. Your support request is with the
                FaithForm team, and we'll reply by email as soon as we've
                looked at it. You can follow the conversation from your
                dashboard at any time.
              </p>
              <p style="margin:0 0 8px;font-size:13px;text-transform:uppercase;letter-spacing:0.04em;color:#6B7280;">
                What you sent us
              </p>
              <p style="margin:0 0 10px;font-size:15px;font-weight:600;color:#002D5F;">
                ${escapeHtml(params.subject)}
              </p>
              ${quoteBlock(params.body)}
              ${button(absoluteAppPath("/dashboard/support"), "View your tickets")}
              <p style="margin:26px 0 0;font-size:13px;color:#6B7280;">
                Need to add something? Just reply to this email.
              </p>`;

  return send({
    to: [params.to],
    subject: `We received your request — ${params.subject}`,
    html: shell(inner),
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
  const inner = `<h1 style="margin:0 0 6px;font-size:20px;color:#002D5F;">
                FaithForm replied to your request
              </h1>
              <p style="margin:0 0 22px;font-size:14px;color:#6B7280;">
                ${escapeHtml(params.subject)} · ${escapeHtml(params.statusLabel)}
              </p>
              ${quoteBlock(params.message)}
              ${button(absoluteAppPath("/dashboard/support"), "Open the conversation")}
              <p style="margin:26px 0 0;font-size:13px;color:#6B7280;">
                Reply to this email to get back to us.
              </p>`;

  return send({
    to: [params.to],
    subject: `Re: ${params.subject}`,
    html: shell(inner),
    label: "Support ticket reply",
  });
}
