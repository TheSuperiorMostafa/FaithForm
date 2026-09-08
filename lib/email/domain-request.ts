import { Resend } from "resend";

import { BOOTSTRAP_SUPERADMIN_EMAILS } from "@/lib/auth/superadmin-emails";
import { resolveFromAddress } from "@/lib/email/sender";
import {
  renderEmail,
  type EmailBlock,
  type RenderedEmail,
} from "@/lib/email/layout";

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

function buildDomainRequestEmail(
  params: DomainRequestEmailParams,
): RenderedEmail {
  const headline =
    params.kind === "connect_existing"
      ? "wants to connect a domain they own"
      : "needs a domain registered";

  const details: EmailBlock[] = [
    { kind: "detail", label: "Church", value: params.churchName },
  ];

  if (params.hostname) {
    details.push({
      kind: "detail",
      label: params.kind === "connect_existing" ? "Domain" : "First choice",
      value: params.hostname,
    });
  }
  if (params.alternateHostnames.length > 0) {
    details.push({
      kind: "detail",
      label: "Alternatives",
      value: params.alternateHostnames.join(", "),
    });
  }
  if (params.registrar) {
    details.push({ kind: "detail", label: "Registrar", value: params.registrar });
  }
  if (params.contactName) {
    details.push({ kind: "detail", label: "Contact", value: params.contactName });
  }
  if (params.contactEmail) {
    details.push({ kind: "detail", label: "Email", value: params.contactEmail });
  }
  if (params.contactPhone) {
    details.push({ kind: "detail", label: "Phone", value: params.contactPhone });
  }

  return renderEmail({
    title: `${params.churchName} ${headline}`,
    preheader: `New domain request from ${params.churchName}.`,
    heading: `${params.churchName} ${headline}`,
    blocks: [
      { kind: "paragraph", text: "New domain request in the control center." },
      ...details,
      ...(params.notes
        ? ([
            { kind: "subheading", text: "Notes" },
            { kind: "quote", text: params.notes },
          ] as EmailBlock[])
        : []),
      { kind: "button", label: "Review request", url: params.reviewUrl },
    ],
    footerNote: "FaithForm control center",
    permissionNote: "You received this because you handle FaithForm domain requests.",
  });
}

export async function sendDomainRequestEmail(
  params: DomainRequestEmailParams,
): Promise<{ sent: boolean }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = resolveFromAddress();
  const to = recipients();

  if (!apiKey || to.length === 0) {
    console.log(
      `[FaithForm] Domain request from ${params.churchName} stored but not emailed.`,
    );
    return { sent: false };
  }

  const content = buildDomainRequestEmail(params);

  try {
    const resend = new Resend(apiKey);
    const { error } = await resend.emails.send({
      from: `FaithForm <${from}>`,
      to,
      // Not replyTo: the church contact is unverified input, and a reply should
      // go through the control center where it is recorded.
      subject: `Domain request — ${params.churchName}`,
      html: content.html,
      text: content.text,
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
