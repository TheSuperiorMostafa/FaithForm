import { Resend } from "resend";
import { escapeHtml } from "@/lib/email/escape-html";
import { absoluteAppPath, getCanonicalSiteUrl } from "@/lib/site-url";

function buildTeamInviteHtml(params: {
  churchName: string;
  loginUrl: string;
  email: string;
  featureLabels: string[];
  isAdmin: boolean;
}): string {
  const accessList = params.isAdmin
    ? "<li style=\"margin:0 0 6px;\">Full admin access to every enabled tool</li>"
    : params.featureLabels.length > 0
      ? params.featureLabels
          .map(
            (label) =>
              `<li style="margin:0 0 6px;">${escapeHtml(label)}</li>`,
          )
          .join("")
      : "<li style=\"margin:0 0 6px;\">Your church admin will grant tool access shortly</li>";

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
                You've been added to ${escapeHtml(params.churchName)} on FaithForm
              </h1>
              <p style="margin:0 0 24px;font-size:16px;color:#374151;line-height:1.6;">
                Your account is ready. Sign in with
                <strong>${escapeHtml(params.email)}</strong> — no password needed,
                FaithForm emails you a one-tap sign-in link.
              </p>

              <p style="margin:0 0 8px;font-size:14px;font-weight:600;color:#002D5F;text-transform:uppercase;letter-spacing:0.06em;">
                What you can access
              </p>
              <ul style="margin:0 0 28px;padding-left:20px;font-size:16px;color:#374151;line-height:1.6;">
                ${accessList}
              </ul>

              <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
                <tr>
                  <td style="background-color:#C5A059;border-radius:10px;">
                    <a href="${params.loginUrl}" style="display:inline-block;padding:16px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">
                      Sign in to FaithForm
                    </a>
                  </td>
                </tr>
              </table>

              <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.5;word-break:break-all;">
                Or copy this link: ${params.loginUrl}
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

export type SendTeamInviteEmailParams = {
  email: string;
  churchName: string;
  featureLabels: string[];
  isAdmin: boolean;
};

/**
 * Tells a new teammate their account exists and points them at the normal
 * magic-link sign-in. Deliberately carries no auth token of its own — the
 * existing login flow is the single, proven path into the app.
 */
export async function sendTeamInviteEmail(
  params: SendTeamInviteEmailParams,
): Promise<{ sent: boolean; loginUrl: string }> {
  const loginUrl = absoluteAppPath("/login");
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "noreply@faithform.io";

  if (!apiKey) {
    console.log(
      `[FaithForm] Team invite (no RESEND_API_KEY): ${params.email} (not sent)`,
    );
    return { sent: false, loginUrl };
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: `FaithForm <${from}>`,
    to: params.email,
    subject: `You've been added to ${params.churchName} on FaithForm`,
    html: buildTeamInviteHtml({
      churchName: params.churchName,
      loginUrl,
      email: params.email,
      featureLabels: params.featureLabels,
      isAdmin: params.isAdmin,
    }),
  });

  if (error) {
    console.error("[FaithForm] Resend error (team invite):", error);
    throw new Error(error.message);
  }

  console.log(
    `[FaithForm] Team invite sent to ${params.email} (site: ${getCanonicalSiteUrl()})`,
  );

  return { sent: true, loginUrl };
}
