import { Resend } from "resend";
import { renderEmail, type RenderedEmail } from "@/lib/email/layout";
import { absoluteAppPath, getCanonicalSiteUrl } from "@/lib/site-url";
import { resolveFromAddress } from "@/lib/email/sender";

function buildInviteEmail(params: {
  churchName: string;
  inviteUrl: string;
  adminFirstName?: string;
}): RenderedEmail {
  const greeting = params.adminFirstName
    ? `Hi ${params.adminFirstName},`
    : "Hello,";

  return renderEmail({
    title: `Set up ${params.churchName} on FaithForm`,
    preheader: `Your setup link for ${params.churchName} — it takes about five minutes.`,
    heading: `You've been invited to set up ${params.churchName} on FaithForm`,
    blocks: [
      { kind: "paragraph", text: greeting },
      {
        kind: "paragraph",
        text: "FaithForm helps your church team track attendance, manage announcements, build sermons, and save hours on weekly ministry admin. Complete your setup to get started — it only takes about 5 minutes.",
      },
      { kind: "button", label: "Complete your setup", url: params.inviteUrl },
      { kind: "muted", text: "This invite expires in 7 days." },
      {
        kind: "muted",
        text: `If the button does not work, paste this into your browser: ${params.inviteUrl}`,
      },
    ],
  });
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
  const from = resolveFromAddress();

  if (!apiKey) {
    console.log(
      `[FaithForm] Invite email (no RESEND_API_KEY): ${params.email} (not sent)`,
    );
    return { sent: false, inviteUrl };
  }

  const content = buildInviteEmail({
    churchName: params.churchName,
    inviteUrl,
    adminFirstName: params.adminFirstName,
  });

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: `FaithForm <${from}>`,
    to: params.email,
    subject: `Set up ${params.churchName} on FaithForm`,
    html: content.html,
    text: content.text,
  });

  if (error) {
    console.error("[FaithForm] Resend error:", error);
    throw new Error(error.message);
  }

  console.log(
    `[FaithForm] Invite sent to ${params.email} (site: ${getCanonicalSiteUrl()})`,
  );

  return { sent: true, inviteUrl };
}
