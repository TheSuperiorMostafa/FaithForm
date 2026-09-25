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
        detail: "Visitors can reach your website at this address.",
      };
    case "dns_ok":
      return {
        label: "Almost ready",
        tone: "working",
        detail: automated
          ? "Your settings are correct. We're finishing the last step, which usually takes a few minutes."
          : "Your settings are correct and your part is done. We'll switch it on and email you when it's live.",
      };
    case "failed":
      return {
        label: "Needs attention",
        tone: "attention",
        detail:
          "This address stopped pointing to your website. Check the settings at your domain company, then check again.",
      };
    case "pending_dns":
    default:
      return {
        label: "Waiting for your domain company",
        tone: "working",
        detail:
          "Add the settings below at the company where you bought this address. It usually takes a few minutes, sometimes an hour.",
      };
  }
}

/** The step-by-step instructions, as plain text for an email body. */
export function domainInstructionsText({
  hostname,
  records,
  churchName,
}: {
  hostname: string;
  records: DnsRecord[];
  churchName?: string | null;
}): string {
  const lines = [
    "Hello,",
    "",
    `${churchName?.trim() || "Our church"} is moving our website to FaithForm, and we'd like it to appear at ${hostname}.`,
    "",
    `Could you please sign in wherever ${hostname} is registered, open its DNS settings, and add ${records.length === 1 ? "this record" : "these records"}:`,
    "",
    ...records.flatMap((record, index) => [
      `${index + 1}. Type: ${record.type}`,
      `   Name / Host: ${record.name}`,
      `   Value / Points to: ${record.value}`,
      `   (${record.note})`,
      "",
    ]),
    "Please leave any email (MX) records exactly as they are. These records only affect the website.",
    "",
    "Once they're saved, FaithForm checks automatically. It usually takes a few minutes, sometimes up to an hour.",
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
