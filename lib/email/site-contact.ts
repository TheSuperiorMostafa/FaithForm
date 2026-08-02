import { Resend } from "resend";

import { escapeHtml } from "@/lib/email/escape-html";

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

function row(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #EAE7E0;vertical-align:top;width:110px;">
        <span style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#6B7280;">${escapeHtml(label)}</span>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #EAE7E0;">
        <span style="font-size:15px;color:#002D5F;">${value}</span>
      </td>
    </tr>`;
}

function buildHtml(params: SiteContactEmailParams): string {
  const rows = [
    row("Name", escapeHtml(params.name)),
    row(
      "Email",
      `<a href="mailto:${escapeHtml(params.email)}" style="color:#002D5F;">${escapeHtml(params.email)}</a>`,
    ),
  ];

  if (params.phone) {
    rows.push(row("Phone", escapeHtml(params.phone)));
  }

  if (params.message) {
    rows.push(
      row("Message", escapeHtml(params.message).replace(/\n/g, "<br />")),
    );
  }

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
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">
          <tr>
            <td style="background-color:#002D5F;padding:28px 40px;">
              <div style="font-size:12px;letter-spacing:0.16em;text-transform:uppercase;color:#C5A059;">New website enquiry</div>
              <div style="font-family:Georgia,serif;font-size:22px;font-weight:700;color:#ffffff;margin-top:6px;">${escapeHtml(params.churchName)}</div>
            </td>
          </tr>
          <tr>
            <td style="padding:32px 40px;">
              <p style="margin:0 0 18px;font-size:15px;line-height:1.6;color:#4B5563;">
                Someone filled in the contact form on your website.
              </p>
              <table width="100%" cellpadding="0" cellspacing="0">${rows.join("")}</table>
              <p style="margin:24px 0 0;font-size:13px;line-height:1.6;color:#6B7280;">
                Reply to this email to answer ${escapeHtml(params.name)} directly.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 40px 28px;">
              <p style="margin:0;font-size:12px;color:#9CA3AF;">
                Sent by FaithForm${params.sourceUrl ? ` from ${escapeHtml(params.sourceUrl)}` : ""}.
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
 * Returns whether the message actually went out. The caller has already stored
 * the submission, so a failure here is logged and reported rather than thrown --
 * losing the lead would be worse than a missed notification.
 */
export async function sendSiteContactEmail(
  params: SiteContactEmailParams,
): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "noreply@faithform.io";

  if (!apiKey) {
    console.log(
      `[FaithForm] Site contact for ${params.churchName} stored but not emailed (no RESEND_API_KEY)`,
    );
    return { sent: false };
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: `FaithForm <${from}>`,
      to: params.recipient,
      replyTo: params.email,
      subject: `New website enquiry from ${params.name}`,
      html: buildHtml(params),
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
