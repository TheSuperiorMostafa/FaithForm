import { Resend } from "resend";
import {
  renderEmail,
  type EmailBlock,
  type RenderedEmail,
} from "@/lib/email/layout";
import { absoluteAppPath, getCanonicalSiteUrl } from "@/lib/site-url";
import { resolveFromAddress } from "@/lib/email/sender";

function buildTeamInviteEmail(params: {
  churchName: string;
  loginUrl: string;
  email: string;
  featureLabels: string[];
  isAdmin: boolean;
  tempPassword: string | null;
}): RenderedEmail {
  const access = params.isAdmin
    ? ["Full admin access to every enabled tool"]
    : params.featureLabels.length > 0
      ? params.featureLabels
      : ["Your church admin will grant tool access shortly"];

  const credentials: EmailBlock[] = params.tempPassword
    ? [
        {
          kind: "callout",
          title: "Your temporary password",
          rows: [
            { label: "Email", value: params.email },
            { label: "Temporary password", value: params.tempPassword, mono: true },
          ],
        },
        {
          kind: "paragraph",
          text: "FaithForm asks you to pick your own password the first time you sign in, and the temporary one stops working right after.",
        },
      ]
    : [
        {
          kind: "paragraph",
          text: `Sign in with ${params.email} and the FaithForm password you already use.`,
        },
      ];

  return renderEmail({
    title: `You've been added to ${params.churchName} on FaithForm`,
    preheader: params.tempPassword
      ? "Your account is ready — here is your temporary password."
      : "Your account is ready. Sign in with your existing password.",
    heading: `You've been added to ${params.churchName} on FaithForm`,
    blocks: [
      { kind: "paragraph", text: "Your account is ready." },
      ...credentials,
      { kind: "subheading", text: "What you can access" },
      { kind: "list", items: access },
      { kind: "button", label: "Sign in to FaithForm", url: params.loginUrl },
      {
        kind: "muted",
        text: `If the button does not work, paste this into your browser: ${params.loginUrl}`,
      },
    ],
  });
}

export type SendTeamInviteEmailParams = {
  email: string;
  churchName: string;
  featureLabels: string[];
  isAdmin: boolean;
  /** Null when the person already had a FaithForm login. */
  tempPassword?: string | null;
};

/**
 * Tells a new teammate their account exists and hands over the temporary
 * password to get in with. It carries no auth token — the password is single
 * use in practice, since FaithForm makes them replace it on first sign-in.
 */
export async function sendTeamInviteEmail(
  params: SendTeamInviteEmailParams,
): Promise<{ sent: boolean; loginUrl: string }> {
  const loginUrl = absoluteAppPath("/login");
  const apiKey = process.env.RESEND_API_KEY;
  const from = resolveFromAddress();

  if (!apiKey) {
    console.log(
      `[FaithForm] Team invite (no RESEND_API_KEY): ${params.email} (not sent)`,
    );
    return { sent: false, loginUrl };
  }

  const content = buildTeamInviteEmail({
    churchName: params.churchName,
    loginUrl,
    email: params.email,
    featureLabels: params.featureLabels,
    isAdmin: params.isAdmin,
    tempPassword: params.tempPassword ?? null,
  });

  const resend = new Resend(apiKey);
  const { error } = await resend.emails.send({
    from: `FaithForm <${from}>`,
    to: params.email,
    subject: `You've been added to ${params.churchName} on FaithForm`,
    html: content.html,
    text: content.text,
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
