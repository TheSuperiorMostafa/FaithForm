import type { DnsRecord } from "./domains";
export type DomainSetupPhase = "connecting" | "ownership" | "dns" | "https" | "ready" | "attention";
export type DomainSetupView = {
  phase: DomainSetupPhase; title: string; description: string;
  checkedAt: string | null; nextCheckAt: string | null;
  records: DnsRecord[]; verification: DnsRecord[]; retryable: boolean;
};
export type DomainJobView = {
  phase: DomainSetupPhase; operation?: "connect" | "disconnect"; redirect_to: string | null;
  records: DnsRecord[]; verification: DnsRecord[]; checked_at: string | null;
  available_at: string | null; last_error_code: string | null;
};
const words: Record<DomainSetupPhase, [string, string]> = {
  connecting: ["Preparing your address", "Your address is saved. We are connecting the hosting automatically."],
  ownership: ["Confirm you own this address", "Add the confirmation record below, or share the instructions with the person who manages your address."],
  dns: ["Update your website settings", "Update the website records below. We will keep checking as the change reaches us."],
  https: ["Finishing your secure connection", "We are checking the secure connection and making sure visitors reach your church website."],
  ready: ["Your address is connected", "The secure connection and church destination have been checked. Publishing your website is a separate step."],
  attention: ["Your connection needs attention", "We could not finish the last check. Your address and progress are saved, and we will try again."],
};
export function domainSetupView(job: DomainJobView): DomainSetupView {
  const phase = job.operation === "disconnect" ? "attention" : job.phase;
  const [title, description] = words[phase] ?? words.attention;
  return {
    phase, title: job.operation === "disconnect" ? "Disconnecting this address" : title,
    description: job.operation === "disconnect" ? "This address no longer opens your website. We are finishing its release in the background." : job.last_error_code === "provider_not_configured"
      ? "FaithForm needs to finish the hosting connection. Your progress is saved; use the preview while we finish." : description,
    checkedAt: job.checked_at, nextCheckAt: job.available_at,
    records: job.records ?? [], verification: job.verification ?? [], retryable: true,
  };
}
/** The slowest family member determines whether both the main and www addresses are ready. */
export function combineDomainSetup(main: DomainSetupView, companions: DomainSetupView[]): DomainSetupView {
  const all = [main, ...companions];
  const active = all.find(item => item.phase !== "ready") ?? main;
  const dedupe = (records: DnsRecord[]) => [...new Map(records.map(record => [`${record.type}:${record.name}:${record.value}`, record])).values()];
  return { ...active, records: dedupe(all.flatMap(item => item.records)), verification: dedupe(all.flatMap(item => item.verification)) };
}
