import { Resend } from "resend";

import { escapeHtml } from "@/lib/email/escape-html";
import { BOOTSTRAP_SUPERADMIN_EMAILS } from "@/lib/auth/superadmin-emails";

/**
 * Tells us a church asked for a domain.
 *
 * A domain request is a promise of human work — someone has to buy a name or
 * walk a pastor through their registrar. The control center is the system of
 * record, but nobody refreshes a queue they are not expecting to have anything
 * in it, so the queue gets a doorbell.
 *
 * Failure is swallowed. The row is already committed by the time this runs; a
 * Resend outage must not turn a stored request into an error the church sees.
 */

export type DomainRequestEmailParams = {
  churchName: string;
  kind: "connect_existing" | "register_new";
  hostname: string | null;
  alternateHostnames: string[];
  registrar: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  /** Deep link to the request in the control center. */
  reviewUrl: string;
};

function row(label: string, value: string): string {
  return `
    <tr>
      <td style="padding:10px 0;border-bottom:1px solid #EAE7E0;vertical-align:top;width:130px;">
        <span style="font-size:12px;letter-spacing:0.06em;text-transform:uppercase;color:#6B7280;">${escapeHtml(label)}</span>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #EAE7E0;">
        <span style="font-size:15px;color:#002D5F;">${value}</span>
      </td>
    </tr>`;
}

function buildHtml(params: DomainRequestEmailParams): string {
  const headline =
    params.kind === "connect_existing"
      ? "wants to connect a domain they own"
      : "needs a domain registered";

  const rows = [row("Church", escapeHtml(params.churchName))];

  if (params.hostname) {
    rows.push(
      row(
        params.kind === "connect_existing" ? "Domain" : "First choice",
        `<code>${escapeHtml(params.hostname)}</code>`,
      ),
    );
  }

  if (params.alternateHostnames.length > 0) {
    rows.push(
      row(
        "Alternatives",
        params.alternateHostnames
          .map((h) => `<code>${escapeHtml(h)}</code>`)
          .join(", "),
      ),
    );
  }

  if (params.registrar) rows.push(row("Registrar", escapeHtml(params.registrar)));
  if (params.contactName) rows.push(row("Contact", escapeHtml(params.contactName)));

  if (params.contactEmail) {
    rows.push(
      row(
        "Email",
        `<a href="mailto:${escapeHtml(params.contactEmail)}" style="color:#002D5F;">${escapeHtml(params.contactEmail)}</a>`,
      ),
    );
  }

  if (params.contactPhone) rows.push(row("Phone", escapeHtml(params.contactPhone)));

  if (params.notes) {
    rows.push(
      row("Notes", escapeHtml(params.notes).replace(/\n/g, "<br />")),
    );
  }

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
                ${escapeHtml(params.churchName)} ${escapeHtml(headline)}
              </h1>
              <p style="margin:0 0 22px;font-size:14px;color:#6B7280;">
                New domain request in the control center.
              </p>
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
                ${rows.join("")}
              </table>
              <p style="margin:26px 0 0;">
                <a href="${escapeHtml(params.reviewUrl)}" style="display:inline-block;background-color:#002D5F;color:#FFFFFF;text-decoration:none;font-size:15px;padding:12px 22px;border-radius:8px;">
                  Open the request
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
 * Recipients are the platform's own admins, never a value from the request —
 * the form is church-supplied input and must not be able to address our mail.
 */
function recipients(): string[] {
  const configured = process.env.DOMAIN_REQUEST_NOTIFY_EMAIL?.trim();
  if (configured) {
    return configured
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean);
  }
  return BOOTSTRAP_SUPERADMIN_EMAILS;
}

export async function sendDomainRequestEmail(
  params: DomainRequestEmailParams,
): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "noreply@faithform.io";
  const to = recipients();

  if (!apiKey || to.length === 0) {
    console.log(
      `[FaithForm] Domain request from ${params.churchName} stored but not emailed.`,
    );
    return { sent: false };
  }

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: `FaithForm <${from}>`,
      to,
      // Not replyTo: the church contact is unverified input, and a reply should
      // go through the control center where it is recorded.
      subject: `Domain request — ${params.churchName}`,
      html: buildHtml(params),
    });

    if (error) {
      console.error("[FaithForm] Domain request Resend error:", error);
      return { sent: false };
    }

    return { sent: true };
  } catch (error) {
    console.error("[FaithForm] Domain request send failed:", error);
    return { sent: false };
  }
}
