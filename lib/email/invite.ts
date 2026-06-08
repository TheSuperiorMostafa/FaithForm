import { Resend } from "resend";
import { absoluteAppPath, getCanonicalSiteUrl } from "@/lib/site-url";

function buildInviteHtml(params: {
  churchName: string;
  inviteUrl: string;
  adminFirstName?: string;
}): string {
  const greeting = params.adminFirstName
    ? `Hi ${params.adminFirstName},`
    : "Hello,";

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
              <p style="margin:0 0 16px;font-size:16px;color:#6B7280;line-height:1.5;">${greeting}</p>
              <h1 style="margin:0 0 20px;font-size:24px;font-weight:700;color:#002D5F;line-height:1.3;">
                You've been invited to set up ${params.churchName} on FaithForm
              </h1>
              <p style="margin:0 0 28px;font-size:16px;color:#374151;line-height:1.6;">
                FaithForm helps your church team track attendance, manage announcements,
                build sermons, and save hours on weekly ministry admin. Complete your
                setup to get started — it only takes about 5 minutes.
              </p>
              <table cellpadding="0" cellspacing="0" style="margin:0 0 32px;">
                <tr>
                  <td style="background-color:#C5A059;border-radius:10px;">
                    <a href="${params.inviteUrl}" style="display:inline-block;padding:16px 32px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none;">
                      Complete Your Setup
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:0 0 12px;font-size:14px;color:#9CA3AF;line-height:1.5;">
                This invite expires in 7 days.
              </p>
              <p style="margin:0;font-size:12px;color:#9CA3AF;line-height:1.5;word-break:break-all;">
                Or copy this link: ${params.inviteUrl}
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

export type SendInviteEmailParams = {
  email: string;
  churchName: string;
  token: string;
  adminFirstName?: string;
};

export async function sendInviteEmail(
  params: SendInviteEmailParams,
): Promise<{ sent: boolean; inviteUrl: string }> {
  const inviteUrl = absoluteAppPath(
    `/onboarding?token=${encodeURIComponent(params.token)}`,
  );
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.RESEND_FROM_EMAIL ?? "noreply@faithform.io";

  if (!apiKey) {
    console.log(
      `[FaithForm] Invite email (no RESEND_API_KEY): ${params.email} → ${inviteUrl}`,
    );
    return { sent: false, inviteUrl };
  }

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: `FaithForm <${from}>`,
    to: params.email,
    subject: `Set up ${params.churchName} on FaithForm`,
    html: buildInviteHtml({
      churchName: params.churchName,
      inviteUrl,
      adminFirstName: params.adminFirstName,
    }),
  });

  if (error) {
    console.error("[FaithForm] Resend error:", error);
    throw new Error(error.message);
  }

  console.log(
    `[FaithForm] Invite sent to ${params.email} → ${inviteUrl} (site: ${getCanonicalSiteUrl()})`,
  );

  return { sent: true, inviteUrl };
}
