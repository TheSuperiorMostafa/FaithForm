import type { DomainStatus } from "@/lib/sites/domain-queries";
import type { DnsRecord } from "@/lib/sites/domains";

/**
 * Plain words and prefilled emails for the Website area. Pure, so they can be
 * tested without rendering anything.
 */

export type PlainTone = "done" | "working" | "attention";

/**
 * The one status vocabulary for a church's own web address (audit §7:
 * "DNS verified / Waiting on DNS" → "Connected / Waiting for your domain
 * company").
 */
export function domainStatusWords(
  status: DomainStatus,
  automated: boolean,
): { label: string; tone: PlainTone; detail: string } {
  switch (status) {
    case "live":
      return {
        label: "Connected",
        tone: "done",
        detail: "Your address is connected. Website publication is managed from Overview.",
      };
    case "dns_ok":
      return {
        label: "Almost ready",
        tone: "working",
        detail: automated
          ? "Your settings are correct. We're finishing the last step, which usually takes a few minutes."
          : "Your settings are correct. The FaithForm team needs to finish the connection. You can follow progress here.",
      };
    case "failed":
      return {
        label: "Needs attention",
        tone: "attention",
        detail:
          "We couldn’t confirm this connection. Check the website settings at your domain company, or ask your IT person to help.",
      };
    case "pending_dns":
    default:
      return {
        label: "Waiting for your domain company",
        tone: "working",
        detail:
          "Add the settings below at the company where you bought this address. Changes can take time to reach everyone.",
      };
  }
}

/** The step-by-step instructions, as plain text for an email body. */
export function domainInstructionsText({
  hostname,
  records,
  churchName,
  automatic = false,
}: {
  hostname: string;
  records: DnsRecord[];
  churchName?: string | null;
  automatic?: boolean;
}): string {
  const lines = [
    "Hello,",
    "",
    `${churchName?.trim() || "Our church"} is moving our website to FaithForm, and we'd like it to appear at ${hostname}.`,
    "",
    `Could you please sign in to the service that manages DNS for ${hostname}, open its website records, and add ${records.length === 1 ? "this record" : "these records"}:`,
    "",
    ...records.flatMap((record, index) => [
      `${index + 1}. Type: ${record.type}`,
      `   Name / Host: ${record.name}`,
      `   Value / Points to: ${record.value}`,
      `   (${record.note})`,
      "",
    ]),
    "Update only the website records listed above. Keep existing email (MX), email verification (TXT), and other service records in place. If a website record conflicts, replace that website record rather than adding a conflicting second value.",
    "",
    automatic
      ? "After saving, FaithForm checks in the background. Domain changes can take time to reach everyone. Our team can follow progress in Website → Your web address."
      : "After saving, our team will choose Check again in Website → Your web address so FaithForm can finish the connection.",
    "",
    "Thank you!",
  ];
  return lines.join("\n");
}

/** A mailto: link with the instructions filled in. The recipient is left for the person to type. */
export function domainInstructionsMailto(input: {
  hostname: string;
  records: DnsRecord[];
  churchName?: string | null;
  automatic?: boolean;
}): string {
  const subject = `Please connect ${input.hostname} to our new church website`;
  return `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(
    domainInstructionsText(input),
  )}`;
}

/** Reply to a contact-form message from the person's own email app. */
export function replyMailto({
  email,
  name,
  churchName,
}: {
  email: string;
  name?: string | null;
  churchName?: string | null;
}): string {
  const subject = churchName?.trim()
    ? `Re: Your message to ${churchName.trim()}`
    : "Re: Your message from our website";
  const greeting = name?.trim() ? `Hi ${name.trim().split(/\s+/)[0]},\n\n` : "";
  const params = [`subject=${encodeURIComponent(subject)}`];
  if (greeting) params.push(`body=${encodeURIComponent(greeting)}`);
  return `mailto:${encodeURIComponent(email.trim()).replace(/%40/g, "@")}?${params.join("&")}`;
}
