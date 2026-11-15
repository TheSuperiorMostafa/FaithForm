/**
 * Custom domain plumbing: what a hostname must look like, what records the
 * church has to add, and whether they added them.
 *
 * Nothing here touches the database. `lib/sites/domain-queries.ts` reads,
 * `app/dashboard/website/domain-actions.ts` and `app/admin/domain-actions.ts`
 * write. Hostname parsing uses the public suffix list; provider requests stay
 * independent of persistence so retries can be controlled by the caller.
 *
 * The platform side is deliberately behind `getDomainProvider()`. Vercel will
 * not serve a hostname that has not been registered against the project, so
 * *someone* must do that. With VERCEL_API_TOKEN set, we do; without it, a
 * platform admin does and the control center tracks it. Both paths produce the
 * same `site_domains` row, so the church-facing UI never branches on which one
 * is in play.
 */

import { parse } from "tldts";
import { DEFAULT_PRODUCTION_SITE_URL } from "@/lib/site-url";

/** A single DNS label: 1-63 chars, alphanumeric with inner hyphens. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function hostnameOf(value: string | undefined): string | null {
  if (!value?.trim()) return null;
  try { return new URL(value.includes("://") ? value.trim() : `https://${value.trim()}`).hostname.toLowerCase().replace(/\.$/, ""); }
  catch { return null; }
}

function platformHosts(): string[] {
  return ["localhost", "localhost.localdomain", "vercel.app", "now.sh", "faithform.app", "faithform.com",
    hostnameOf(DEFAULT_PRODUCTION_SITE_URL),
    hostnameOf(process.env.NEXT_PUBLIC_SITE_ROOT_HOST),
    hostnameOf(process.env.NEXT_PUBLIC_SITE_URL), hostnameOf(process.env.SITE_URL),
    hostnameOf(process.env.INVITE_SITE_URL), hostnameOf(process.env.NEXT_PUBLIC_GIVE_HOST),
  ].filter((value): value is string => Boolean(value));
}

export type HostnameResult =
  | { ok: true; hostname: string; isApex: boolean }
  | { ok: false; error: string };

/** Accept a pasted web address, canonicalize IDNs, and reject platform/public suffixes. */
export function normalizeHostname(input: string): HostnameResult {
  const raw = (input ?? "").trim();
  if (!raw) return { ok: false, error: "Enter a domain name." };
  let url: URL;
  try { url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`); }
  catch { return { ok: false, error: "Enter a full domain, like gracechurch.org." }; }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    return { ok: false, error: "Enter your website address without sign-in details." };
  }
  const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
  const labels = hostname.split(".");
  const parsed = parse(hostname, { allowPrivateDomains: true });
  if (parsed.isIp || hostname.includes("[") || /^[0-9.]+$/.test(hostname)) {
    return { ok: false, error: "Enter a domain name, not an IP address." };
  }
  if (hostname.length > 253 || labels.some(label => !LABEL.test(label)) || labels.length < 2
      || !parsed.domain || /^[0-9]+$/.test(labels[labels.length - 1])) {
    return { ok: false, error: "Enter a full domain, like gracechurch.org." };
  }
  if (platformHosts().some(host => hostname === host || hostname.endsWith(`.${host}`))) {
    return { ok: false, error: "That address belongs to FaithForm or its hosting service. Enter your church's own domain." };
  }
  return { ok: true, hostname, isApex: parsed.domain === hostname };
}

export type DomainHostnamePlan = { hostname: string; redirectTo: string | null };

/** Reserve both variants together; existing www input selects the registrable apex. */
export function domainHostnames(input: string): DomainHostnamePlan[] {
  const normalized = normalizeHostname(input);
  if (!normalized.ok) return [];
  const domain = parse(normalized.hostname, { allowPrivateDomains: true }).domain!;
  const canonical = normalized.hostname === `www.${domain}` ? domain : normalized.hostname;
  return canonical === domain
    ? [{ hostname: canonical, redirectTo: null }, { hostname: `www.${canonical}`, redirectTo: canonical }]
    : [{ hostname: canonical, redirectTo: null }];
}

export type DnsRecord = {
  type: "A" | "CNAME" | "TXT";
  /** Relative to the registrar's zone; @ is its root. */
  name: string;
  value: string;
  note: string;
};

/** General-purpose fallbacks remain valid; automation uses project-specific API values. */
function defaultDnsTargets() {
  return { a: process.env.SITE_DNS_A_RECORD?.trim() || "76.76.21.21", cname: process.env.SITE_DNS_CNAME_TARGET?.trim() || "cname.vercel-dns.com" };
}

function recordName(hostname: string, apex: string): string {
  return hostname === apex ? "@" : hostname.endsWith(`.${apex}`) ? hostname.slice(0, -(apex.length + 1)) : hostname;
}

export function dnsRecordsFor(hostname: string): DnsRecord[] {
  const normalized = normalizeHostname(hostname);
  if (!normalized.ok) return [];
  const apex = parse(normalized.hostname, { allowPrivateDomains: true }).domain!;
  const targets = defaultDnsTargets();
  if (normalized.isApex) return [
    { type: "A", name: "@", value: targets.a, note: `Points ${hostname} at FaithForm.` },
    { type: "CNAME", name: "www", value: targets.cname, note: `Connects www.${hostname} as well.` },
  ];
  return [{ type: "CNAME", name: recordName(normalized.hostname, apex), value: targets.cname, note: `Points ${hostname} at FaithForm.` }];
}

// ---------------------------------------------------------------------------
// DNS CHECK
// ---------------------------------------------------------------------------

export type DnsCheckResult = {
  ok: boolean;
  /** False means the resolver could not establish DNS state, not bad DNS. */
  available: boolean;
  /** One sentence, shown to the church verbatim. */
  detail: string;
};

type DohAnswer = { name: string; type: number; data: string };

const DNS_TYPE_A = 1;
const DNS_TYPE_CNAME = 5;

/**
 * Resolves a hostname over DNS-over-HTTPS.
 *
 * Node's `dns` module would be the obvious choice, but this has to run in
 * route handlers that may be deployed to the edge runtime, where it does not
 * exist. A plain fetch works everywhere.
 */
async function resolve(
  hostname: string,
  type: number,
): Promise<DohAnswer[] | null> {
  const url = new URL("https://cloudflare-dns.com/dns-query");
  url.searchParams.set("name", hostname);
  url.searchParams.set("type", String(type));

  try {
    const response = await fetch(url, {
      headers: { accept: "application/dns-json" },
      cache: "no-store",
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) return null;

    const body = (await response.json()) as { Status?: number; Answer?: DohAnswer[] };
    if (body.Status !== undefined && ![0, 3].includes(body.Status)) return null;
    if (body.Answer !== undefined && !Array.isArray(body.Answer)) return null;
    return body.Answer ?? [];
  } catch {
    // A resolver timeout is not evidence about the church's DNS.
    return null;
  }
}

function stripDot(value: string): string {
  return value.replace(/\.$/, "").toLowerCase();
}

/**
 * Whether a hostname currently points at us.
 *
 * Accepts either shape rather than insisting on the one we recommended: plenty
 * of registrars offer ALIAS/ANAME at the apex, and Cloudflare's proxy flattens
 * a CNAME into an A record. All of those work; failing them would send a church
 * that did it right back to their registrar for no reason.
 */
export async function checkDns(hostname: string): Promise<DnsCheckResult> {
  const { a: A_TARGET, cname: CNAME_TARGET } = defaultDnsTargets();
  const [cnames, addresses] = await Promise.all([
    resolve(hostname, DNS_TYPE_CNAME),
    resolve(hostname, DNS_TYPE_A),
  ]);

  if (cnames === null && addresses === null) {
    return {
      ok: false,
      available: false,
      detail: "Couldn't reach the DNS resolver. Try the check again shortly.",
    };
  }

  const cnameValues = (cnames ?? [])
    .filter((a) => a.type === DNS_TYPE_CNAME)
    .map((a) => stripDot(a.data));

  if (cnameValues.some((value) => value === stripDot(CNAME_TARGET))) {
    return { ok: true, available: true, detail: `CNAME points to ${CNAME_TARGET}.` };
  }

  const aValues = (addresses ?? [])
    .filter((a) => a.type === DNS_TYPE_A)
    .map((a) => a.data.trim());

  if (aValues.includes(A_TARGET)) {
    return { ok: true, available: true, detail: `A record points to ${A_TARGET}.` };
  }

  if (cnames === null || addresses === null) return {
    ok: false, available: false, detail: "The domain settings could not be fully checked. We'll try again shortly.",
  };

  // An A record that resolved through a CNAME chain we do not recognise still
  // tells the church something useful, so report what is actually there.
  const found = [
    ...cnameValues.map((v) => `CNAME → ${v}`),
    ...aValues.map((v) => `A → ${v}`),
  ];

  if (found.length === 0) {
    return {
      ok: false,
      available: true,
      detail:
        "No DNS record found yet. New records can take up to an hour to spread.",
    };
  }

  return {
    ok: false,
    available: true,
    detail: `Found ${found.slice(0, 3).join(", ")} — expected ${CNAME_TARGET} or ${A_TARGET}.`,
  };
}

// ---------------------------------------------------------------------------
// PLATFORM PROVIDER
// ---------------------------------------------------------------------------

export type ProviderErrorCode = "unavailable" | "rate_limited" | "unauthorized" | "conflict" | "not_found" | "invalid" | "verification_pending";
export type ProviderResult =
  | { ok: true; providerDomainId: string | null; serving: boolean; ownershipVerified?: boolean; dnsConfigured?: boolean; apexName?: string; redirect?: string | null; records?: DnsRecord[]; verification?: DnsRecord[] }
  | { ok: false; error: string; code: ProviderErrorCode; retryable: boolean; retryAfterSeconds?: number };
export type DomainRegistrationOptions = { redirect?: string | null; redirectStatusCode?: 307 | 308 };
export type DomainProvider = {
  readonly name: "vercel" | "manual";
  readonly automated: boolean;
  register(hostname: string, options?: DomainRegistrationOptions): Promise<ProviderResult>;
  status(hostname: string): Promise<ProviderResult>;
  verify(hostname: string): Promise<ProviderResult>;
  remove(hostname: string): Promise<ProviderResult>;
};
const manualResult = (): ProviderResult => ({ ok: true, providerDomainId: null, serving: false, ownershipVerified: false, dnsConfigured: false, records: [], verification: [] });
const manualProvider: DomainProvider = { name: "manual", automated: false, register: async () => manualResult(), status: async () => manualResult(), verify: async () => manualResult(), remove: async () => manualResult() };

/** Admin diagnostics only: never return credential values to a client. */
export function getDomainProviderReadiness(): { configured: boolean; missing: string[] } {
  const missing = ["VERCEL_API_TOKEN", "VERCEL_PROJECT_ID"].filter(key => !process.env[key]?.trim());
  return { configured: missing.length === 0, missing };
}
type VercelConfig = { token: string; projectId: string; teamId?: string };
function vercelConfig(): VercelConfig | null {
  if (!getDomainProviderReadiness().configured) return null;
  return { token: process.env.VERCEL_API_TOKEN!.trim(), projectId: process.env.VERCEL_PROJECT_ID!.trim(), teamId: process.env.VERCEL_TEAM_ID?.trim() };
}
function vercelUrl(config: VercelConfig, path: string): URL {
  const url = new URL(`https://api.vercel.com${path}`);
  if (config.teamId) url.searchParams.set("teamId", config.teamId);
  return url;
}
type ApiResult = { ok: boolean; status: number; body: Record<string, unknown>; retryAfterSeconds?: number };
async function vercelFetch(config: VercelConfig, path: string, init?: RequestInit): Promise<ApiResult> {
  try {
    const response = await fetch(vercelUrl(config, path), {
      ...init, headers: { authorization: `Bearer ${config.token}`, "content-type": "application/json", ...(init?.headers ?? {}) },
      cache: "no-store", redirect: "error", signal: AbortSignal.timeout(8000),
    });
    const retryAfter = response.headers.get("retry-after");
    const reset = response.headers.get("x-ratelimit-reset");
    const rawSeconds = retryAfter ? (/^\d+$/.test(retryAfter) ? Number(retryAfter) : (Date.parse(retryAfter) - Date.now()) / 1000) : reset ? Number(reset) - Date.now() / 1000 : NaN;
    const retryAfterSeconds = Number.isFinite(rawSeconds) ? Math.min(24 * 3600, Math.max(1, Math.ceil(rawSeconds))) : undefined;
    let body: unknown = {};
    if (response.status !== 204) {
      try { body = await response.json(); }
      catch { if (response.ok) return { ok: false, status: 502, body: {} }; }
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, status: 502, body: {} };
    return { ok: response.ok, status: response.status, body: body as Record<string, unknown>, retryAfterSeconds };
  } catch {
    // Do not log request options, authorization, or provider exception text.
    return { ok: false, status: 503, body: {} };
  }
}
function providerFailure(result: ApiResult, fallback?: ProviderErrorCode): Extract<ProviderResult, { ok: false }> {
  const code: ProviderErrorCode = fallback ?? (result.status === 429 ? "rate_limited" : [401, 403].includes(result.status) ? "unauthorized" : result.status === 404 ? "not_found" : result.status === 409 ? "conflict" : result.status >= 500 || [408, 425].includes(result.status) ? "unavailable" : "invalid");
  const errors: Record<ProviderErrorCode, string> = {
    unavailable: "We couldn't reach the website host. We'll try again shortly.",
    rate_limited: "The website host is busy. We'll try again shortly.",
    unauthorized: "FaithForm needs to reconnect to the website host. Contact support.",
    conflict: "This domain is already connected elsewhere. Contact support to finish moving it.",
    not_found: "This domain hasn't been connected to the website host yet.",
    invalid: "The website host couldn't accept these settings. Contact support.",
    verification_pending: "Your domain ownership check is still waiting for the requested record.",
  };
  return { ok: false, error: errors[code], code, retryable: ["unavailable", "rate_limited", "verification_pending"].includes(code), ...(result.retryAfterSeconds ? { retryAfterSeconds: result.retryAfterSeconds } : {}) };
}
function validRecordHost(value: unknown): value is string {
  return typeof value === "string" && value.length <= 254 && value.replace(/\.$/, "").split(".").every(label => LABEL.test(label));
}
function preferredValue(input: unknown, ipv4: boolean): string | undefined {
  if (!Array.isArray(input)) return undefined;
  const ranked = input.filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object" && !Array.isArray(row))
    .sort((a, b) => Number(a.rank ?? Infinity) - Number(b.rank ?? Infinity));
  for (const item of ranked) {
    const values = Array.isArray(item.value) ? item.value : [item.value];
    for (const value of values) {
      if (ipv4 ? typeof value === "string" && /^\d{1,3}(?:\.\d{1,3}){3}$/.test(value) && value.split(".").every(part => Number(part) <= 255) : validRecordHost(value)) return value;
    }
  }
}
function recommendedRecords(hostname: string, body: Record<string, unknown>): DnsRecord[] {
  const apex = parse(hostname, { allowPrivateDomains: true }).domain!;
  const defaults = defaultDnsTargets();
  return hostname === apex
    ? [{ type: "A", name: "@", value: preferredValue(body.recommendedIPv4, true) ?? defaults.a, note: `Points ${hostname} at FaithForm.` }]
    : [{ type: "CNAME", name: recordName(hostname, apex), value: preferredValue(body.recommendedCNAME, false) ?? defaults.cname, note: `Points ${hostname} at FaithForm.` }];
}
function verificationRecords(body: Record<string, unknown>, hostname: string): DnsRecord[] {
  if (!Array.isArray(body.verification)) return [];
  const apex = parse(hostname, { allowPrivateDomains: true }).domain!;
  return body.verification.flatMap((raw): DnsRecord[] => {
    if (!raw || typeof raw !== "object") return [];
    const item = raw as Record<string, unknown>;
    if (item.type !== "TXT" || typeof item.domain !== "string" || typeof item.value !== "string" || item.value.length > 4096) return [];
    const domain = item.domain.toLowerCase().replace(/\.$/, "");
    // A challenge must belong to this registrable domain, never another zone.
    if (!(domain === apex || domain.endsWith(`.${apex}`)) || !/^[a-z0-9_.-]+$/.test(domain)) return [];
    return [{ type: "TXT", name: recordName(domain, apex), value: item.value, note: "Confirms your church controls this domain. Keep existing email records." }];
  });
}
function makeVercelProvider(config: VercelConfig): DomainProvider {
  const base = `/v10/projects/${encodeURIComponent(config.projectId)}/domains`;
  const projectPath = (hostname: string) => `/v9/projects/${encodeURIComponent(config.projectId)}/domains/${encodeURIComponent(hostname)}`;
  function belongsToProject(hostname: string, body: Record<string, unknown>): boolean {
    return body.name === hostname && typeof body.verified === "boolean" && !(config.projectId.startsWith("prj_") && typeof body.projectId === "string" && body.projectId !== config.projectId);
  }
  async function snapshot(hostname: string, body: Record<string, unknown>): Promise<ProviderResult> {
    if (!belongsToProject(hostname, body)) return providerFailure({ ok: false, status: 502, body: {} });
    if ((typeof body.gitBranch === "string" && body.gitBranch.trim()) || (typeof body.customEnvironmentId === "string" && body.customEnvironmentId.trim())) return providerFailure({ ok: false, status: 400, body: {} });
    const ownershipVerified = body.verified === true;
    const verification = verificationRecords(body, hostname);
    const configuration = await vercelFetch(config, `/v6/domains/${encodeURIComponent(hostname)}/config?projectIdOrName=${encodeURIComponent(config.projectId)}`);
    // Before ownership is proved, the project read and TXT challenge are authoritative.
    // Vercel can deny DNS diagnostics on an unverified external domain.
    if (!configuration.ok && !(configuration.status === 403 && !ownershipVerified && verification.length > 0)) return providerFailure(configuration);
    if (configuration.ok && typeof configuration.body.misconfigured !== "boolean") return providerFailure({ ok: false, status: 502, body: {} });
    const dnsConfigured = configuration.ok && configuration.body.misconfigured === false;
    return { ok: true, providerDomainId: hostname, serving: ownershipVerified && dnsConfigured, ownershipVerified, dnsConfigured,
      apexName: parse(hostname, { allowPrivateDomains: true }).domain!,
      redirect: typeof body.redirect === "string" ? body.redirect : null,
      records: recommendedRecords(hostname, configuration.body), verification };
  }
  function validHostname(hostname: string): boolean { const normalized = normalizeHostname(hostname); return normalized.ok && normalized.hostname === hostname; }
  const invalid = () => providerFailure({ ok: false, status: 400, body: {} });
  async function status(hostname: string): Promise<ProviderResult> {
    if (!validHostname(hostname)) return invalid();
    const result = await vercelFetch(config, projectPath(hostname));
    return result.ok ? snapshot(hostname, result.body) : providerFailure(result);
  }
  return {
    name: "vercel", automated: true,
    async register(hostname, options = {}) {
      if (!validHostname(hostname) || options.redirect === hostname || (options.redirect && !validHostname(options.redirect)) || (options.redirectStatusCode !== undefined && ![307, 308].includes(options.redirectStatusCode))) return invalid();
      const desired = { ...(options.redirect !== undefined ? { redirect: options.redirect } : {}), ...(options.redirectStatusCode !== undefined ? { redirectStatusCode: options.redirectStatusCode } : {}) };
      let result = await vercelFetch(config, base, { method: "POST", body: JSON.stringify({ name: hostname, ...desired }) });
      if (!result.ok && [400, 409].includes(result.status)) {
        // A conflict is idempotent only when our own project confirms membership.
        const existing = await vercelFetch(config, projectPath(hostname));
        if (!existing.ok) {
          if (existing.status >= 500 || [401, 403, 408, 425, 429].includes(existing.status)) return providerFailure(existing);
          return providerFailure(result, result.status === 409 ? "conflict" : undefined);
        }
        if (!belongsToProject(hostname, existing.body)) return providerFailure({ ok: false, status: 502, body: {} });
        result = existing;
        if ((options.redirect !== undefined && (existing.body.redirect ?? null) !== options.redirect)
            || (options.redirect && options.redirectStatusCode !== undefined && existing.body.redirectStatusCode !== options.redirectStatusCode)) {
          result = await vercelFetch(config, projectPath(hostname), { method: "PATCH", body: JSON.stringify(desired) });
        }
      }
      return result.ok ? snapshot(hostname, result.body) : providerFailure(result);
    },
    status,
    async verify(hostname) {
      if (!validHostname(hostname)) return invalid();
      const result = await vercelFetch(config, `${projectPath(hostname)}/verify`, { method: "POST" });
      if (result.ok) return snapshot(hostname, result.body);
      // A pending TXT challenge is normal; preserve the current challenge instructions.
      if ([400, 409].includes(result.status)) return status(hostname);
      return providerFailure(result);
    },
    async remove(hostname) {
      if (!validHostname(hostname)) return invalid();
      const result = await vercelFetch(config, projectPath(hostname), { method: "DELETE" });
      if (!result.ok && result.status !== 404) return providerFailure(result);
      return { ok: true, providerDomainId: null, serving: false };
    },
  };
}
export function getDomainProvider(): DomainProvider {
  const config = vercelConfig();
  return config ? makeVercelProvider(config) : manualProvider;
}
