import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { domainHostnames, getDomainProvider, dnsRecordsFor, normalizeHostname, type DomainProvider, type DnsRecord } from "./domains";
import { probeChurchDomain, type DomainProbeResult } from "./domain-probe";
import type { DomainSetupPhase } from "./domain-setup-state";

export type DomainJobClaim = {
  domain_id: string; lease_token: string; attempts: number;
  redirect_to: string | null; operation: "connect" | "disconnect";
  phase: DomainSetupPhase; records: DnsRecord[]; verification: DnsRecord[];
};
type Dependencies = {
  provider: () => DomainProvider;
  probe: (input: Parameters<typeof probeChurchDomain>[0]) => Promise<DomainProbeResult>;
  now: () => number;
};
const defaults: Dependencies = { provider: getDomainProvider, probe: probeChurchDomain, now: Date.now };

export function domainRetryDelay(attempts: number, identity: string, retryAfter = 0): number {
  let hash = 0; for (const char of identity) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  const base = Math.min(60_000 * 2 ** Math.min(Math.max(attempts - 1, 0), 6), 60 * 60_000);
  return Math.min(Math.max(base + hash % 15000, retryAfter * 1000), 24 * 60 * 60_000);
}
export async function reserveDomainSetup(input: { churchId: string; hostname: string; userId: string | null; details?: Record<string, string | null> }, client = createAdminClient()): Promise<{ ok: true; hostname: string; domainId: string } | { ok: false; error: string }> {
  const normalized = normalizeHostname(input.hostname);
  if (!normalized.ok) return normalized;
  const family = domainHostnames(normalized.hostname);
  const canonical = family.find(domain => !domain.redirectTo)!;
  const companion = family.find(domain => domain.redirectTo)?.hostname ?? null;
  const { data, error } = await client.rpc("reserve_site_domain_setup", {
    p_church_id: input.churchId, p_hostname: canonical.hostname, p_companion: companion,
    p_requested_by: input.userId, p_details: input.details ?? {},
  });
  if (error || !data?.ok) {
    const code = data?.code;
    return { ok: false, error: code === "request_in_progress" ? "A different address request is already in progress. Finish or cancel it before starting another."
      : code === "disconnect_in_progress" ? "This address is still being disconnected. Wait for that to finish before connecting it again."
        : code === "domain_unavailable" ? "That address is already reserved. Contact FaithForm if you need help connecting it."
          : "We couldn't save your address. Please try again." };
  }
  return { ok: true, hostname: canonical.hostname, domainId: data.domainId };
}
async function finish(client: SupabaseClient, claim: DomainJobClaim, phase: DomainSetupPhase, records: DnsRecord[], verification: DnsRecord[], code: string | null, deps: Dependencies, activate = false, retryAfter = 0, paused = false): Promise<boolean> {
  const delay = phase === "ready" ? 6 * 60 * 60_000 : domainRetryDelay(claim.attempts, claim.domain_id, retryAfter);
  const { data, error } = await client.rpc("finish_site_domain_job", {
    p_domain_id: claim.domain_id, p_lease_token: claim.lease_token, p_phase: phase,
    p_records: records, p_verification: verification, p_error_code: code,
    p_next_check_at: paused ? null : new Date(deps.now() + delay).toISOString(), p_activate: activate,
  });
  return !error && data === true;
}
export async function processDomainClaim(claim: DomainJobClaim, client: SupabaseClient, deps: Dependencies = defaults): Promise<"ready" | "deferred" | "removed" | "stale"> {
  let records = claim.records ?? [], verification = claim.verification ?? [];
  try {
    const { data: domain, error } = await client.from("site_domains").select("id, church_id, hostname, status, verified_at, churches(slug)").eq("id", claim.domain_id).maybeSingle();
    if (error) throw new Error("domain_read_failed");
    if (!domain) return "stale";
    const hostname = String(domain.hostname);
    const normalized = normalizeHostname(hostname);
    if (!normalized.ok || normalized.hostname !== hostname) {
      await finish(client, claim, "attention", records, verification, "invalid_hostname", deps); return "deferred";
    }
    const provider = deps.provider();
    if (claim.operation === "disconnect") {
      if (!provider.automated) {
        await finish(client, claim, "attention", records, verification, "provider_not_configured", deps); return "deferred";
      }
      const removed = await provider.remove(hostname);
      if (!removed.ok) {
        await finish(client, claim, "attention", records, verification, removed.code ?? "provider_unavailable", deps, false, removed.retryAfterSeconds, !removed.retryable); return "deferred";
      }
      const completed = await client.rpc("finish_site_domain_disconnect", { p_domain_id: claim.domain_id, p_lease_token: claim.lease_token });
      return !completed.error && completed.data === true ? "removed" : "stale";
    }
    if (provider.automated) {
      let platform = await provider.register(hostname, { redirect: claim.redirect_to, redirectStatusCode: 308 });
      if (!platform.ok) {
        await finish(client, claim, "attention", records, verification, platform.code ?? "provider_unavailable", deps, false, platform.retryAfterSeconds, !platform.retryable); return "deferred";
      }
      records = platform.records?.length ? platform.records : dnsRecordsFor(hostname).filter(record => !normalized.isApex || record.name !== "www");
      verification = platform.verification ?? [];
      if (platform.ownershipVerified === false) {
        platform = await provider.verify(hostname);
        if (!platform.ok) {
          await finish(client, claim, "ownership", records, verification, platform.code ?? "ownership_pending", deps, false, platform.retryAfterSeconds, !platform.retryable); return "deferred";
        }
      }
      records = platform.records?.length ? platform.records : dnsRecordsFor(hostname).filter(record => !normalized.isApex || record.name !== "www");
      verification = platform.verification ?? [];
      if (platform.ownershipVerified === false) {
        await finish(client, claim, "ownership", records, verification, "ownership_pending", deps); return "deferred";
      }
      if (!platform.serving) {
        await finish(client, claim, "dns", records, verification, "dns_pending", deps); return "deferred";
      }
    } else {
      records = dnsRecordsFor(hostname).filter(record => !normalized.isApex || record.name !== "www");
    }
    const church = domain.churches as unknown as { slug: string } | null;
    if (!church?.slug) throw new Error("church_read_failed");
    const { data: settings, error: settingsError } = await client.from("site_settings").select("is_published").eq("church_id", domain.church_id).maybeSingle();
    if (settingsError) throw new Error("settings_read_failed");
    const probe = await deps.probe({ hostname, slug: church.slug, published: settings?.is_published === true, redirectTo: claim.redirect_to });
    if (!probe.ok) {
      const code = !provider.automated && !domain.verified_at ? "provider_not_configured" : probe.code;
      await finish(client, claim, provider.automated || domain.verified_at ? "https" : "attention", records, verification, code, deps); return "deferred";
    }
    const completed = await finish(client, claim, "ready", records, verification, null, deps, true);
    return completed ? "ready" : "stale";
  } catch {
    console.warn("[domains] connection check deferred", { domainId: claim.domain_id });
    await finish(client, claim, "attention", records, verification, "check_unavailable", deps).catch(() => false);
    return "deferred";
  }
}
export async function runDomainChecks(options: { domainId?: string; client?: SupabaseClient; deps?: Dependencies } = {}) {
  const client = options.client ?? createAdminClient(), deps = options.deps ?? defaults;
  const summary = { checked: 0, ready: 0, deferred: 0, removed: 0, failed: false };
  const deadline = deps.now() + 55_000;
  try {
    for (let batch = 0; batch < (options.domainId ? 1 : 4) && deps.now() < deadline; batch++) {
      const { data, error } = await client.rpc("claim_site_domain_jobs", { p_limit: options.domainId ? 1 : 2, p_domain_id: options.domainId ?? null });
      if (error) throw new Error("claim_unavailable");
      const claims = (data ?? []) as DomainJobClaim[];
      if (!claims.length) break;
      const outcomes = await Promise.all(claims.map(claim => processDomainClaim(claim, client, deps)));
      summary.checked += outcomes.length;
      for (const outcome of outcomes) if (outcome === "ready" || outcome === "deferred" || outcome === "removed") summary[outcome]++;
    }
  } catch { summary.failed = true; console.warn("[domains] background check unavailable"); }
  return summary;
}
export async function requestDomainCheck(churchId: string, domainId: string, client = createAdminClient()): Promise<boolean> {
  const { data, error } = await client.rpc("request_site_domain_check", { p_church_id: churchId, p_domain_id: domainId });
  return !error && data === true;
}
export async function disconnectDomain(churchId: string, domainId: string, client = createAdminClient()): Promise<boolean> {
  const { data, error } = await client.rpc("request_site_domain_disconnect", { p_church_id: churchId, p_domain_id: domainId });
  return !error && data === true;
}
