import { Resend } from "resend";

import { BOOTSTRAP_SUPERADMIN_EMAILS } from "@/lib/auth/superadmin-emails";
import { escapeHtml } from "@/lib/email/escape-html";
import { isSmsConfigured, sendSms } from "@/lib/sms/send-sms";

/**
 * Tells us a church raised a support ticket.
 *
 * The control center is the system of record, but nobody sits refreshing a
 * queue on the off-chance — a church waiting on us has no idea whether anyone
 * has looked. So the queue gets a doorbell: an email always, and a text when a
 * number is configured, for the times somebody needs waking up.
 *
 * Failure is swallowed throughout. The ticket row is committed before any of
 * this runs, and a Resend or SMS outage must never turn a saved ticket into an
 * error the church sees.
 */

export type SupportTicketEmailParams = {
  churchName: string;
  subject: string;
  body: string | null;
  submittedByEmail: string | null;
  priority: string;
  /** Deep link to the ticket in the control center. */
  reviewUrl: string;
};

function buildHtml(params: SupportTicketEmailParams): string {
  const bodyHtml = params.body
    ? escapeHtml(params.body).replace(/\n/g, "<br />")
    : "<em>No details given.</em>";

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
              <h1 style="margin:0 0 6px;font-size:20px;color:#002D5F;">
                ${escapeHtml(params.subject)}
              </h1>
              <p style="margin:0 0 22px;font-size:14px;color:#6B7280;">
                New support ticket from ${escapeHtml(params.churchName)}${
                  params.submittedByEmail
                    ? ` · ${escapeHtml(params.submittedByEmail)}`
                    : ""
                } · ${escapeHtml(params.priority)} priority
              </p>
              <div style="font-size:15px;line-height:1.6;color:#002D5F;border-left:3px solid #C9A227;padding-left:14px;">
                ${bodyHtml}
              </div>
              <p style="margin:26px 0 0;">
                <a href="${escapeHtml(params.reviewUrl)}" style="display:inline-block;background-color:#002D5F;color:#FFFFFF;text-decoration:none;font-size:15px;padding:12px 22px;border-radius:8px;">
                  Open the ticket
                </a>
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

/**
 * Recipients are the platform's own admins, never a value from the ticket — the
 * form is church-supplied input and must not be able to address our mail.
 */
function recipients(): string[] {
  const configured = process.env.SUPPORT_NOTIFY_EMAIL?.trim();
  if (configured) {
    return configured
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return BOOTSTRAP_SUPERADMIN_EMAILS;
}

function textRecipients(): string[] {
  return (process.env.SUPPORT_NOTIFY_SMS?.trim() ?? "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export async function sendSupportTicketNotification(
  params: SupportTicketEmailParams,
): Promise<{ emailed: boolean; texted: boolean }> {
  const result = { emailed: false, texted: false };

  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "noreply@faithform.io";
  const to = recipients();

  if (apiKey && to.length > 0) {
    try {
      const resend = new Resend(apiKey);
      const { error } = await resend.emails.send({
        from: `FaithForm <${from}>`,
        to,
        subject: `Support — ${params.churchName}: ${params.subject}`,
        html: buildHtml(params),
      });
      if (error) {
        console.error("[FaithForm] Support ticket Resend error:", error);
      } else {
        result.emailed = true;
      }
    } catch (error) {
      console.error("[FaithForm] Support ticket email failed:", error);
    }
  } else {
    console.log(
      `[FaithForm] Support ticket from ${params.churchName} stored but not emailed.`,
    );
  }

  const numbers = textRecipients();
  if (numbers.length > 0 && isSmsConfigured()) {
    const message = `FaithForm support — ${params.churchName}: ${params.subject}`.slice(
      0,
      300,
    );
    for (const number of numbers) {
      try {
        const sent = await sendSms(number, message);
        if (sent.ok) result.texted = true;
      } catch (error) {
        console.error("[FaithForm] Support ticket text failed:", error);
      }
    }
  }

  return result;
}
