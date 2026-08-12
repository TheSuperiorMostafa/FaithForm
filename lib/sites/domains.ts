/**
 * Custom domain plumbing: what a hostname must look like, what records the
 * church has to add, and whether they added them.
 *
 * Nothing here touches the database. `lib/sites/domain-queries.ts` reads,
 * `app/dashboard/website/domain-actions.ts` and `app/admin/domain-actions.ts`
 * write. This module is the part that has to be right regardless of who calls
 * it, so it stays pure and dependency-free.
 *
 * The platform side is deliberately behind `getDomainProvider()`. Vercel will
 * not serve a hostname that has not been registered against the project, so
 * *someone* must do that. With VERCEL_API_TOKEN set, we do; without it, a
 * platform admin does and the control center tracks it. Both paths produce the
 * same `site_domains` row, so the church-facing UI never branches on which one
 * is in play.
 */

// ---------------------------------------------------------------------------
// HOSTNAME NORMALISATION
// ---------------------------------------------------------------------------

/**
 * Hostnames that must never resolve to a church, whatever a form says.
 * `subdomainSlug()` in tenant.ts guards the *slug* side of this; this guards
 * the custom-domain side, which is the one an untrusted form can reach.
 */
const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "vercel.app",
  "now.sh",
]);

/** A single DNS label: 1-63 chars, alphanumeric with inner hyphens. */
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export type HostnameResult =
  | { ok: true; hostname: string; isApex: boolean }
  | { ok: false; error: string };

/**
 * Turns whatever a pastor pasted into a bare lowercase hostname, or explains
 * why it is not one.
 *
 * People paste `https://www.gracechurch.org/give`, `GraceChurch.ORG`, and
 * `gracechurch.org.` — all three are the same domain and all three should be
 * accepted rather than bounced back with a format lecture.
 */
export function normalizeHostname(input: string): HostnameResult {
  let value = (input ?? "").trim().toLowerCase();

  if (!value) return { ok: false, error: "Enter a domain name." };

  // Strip a pasted URL down to its host.
  value = value.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  value = value.split("/")[0];
  value = value.split("?")[0];
  value = value.split("@").pop() ?? value;
  value = value.split(":")[0];
  // A fully-qualified name may carry a trailing root dot.
  value = value.replace(/\.$/, "");

  if (!value) return { ok: false, error: "Enter a domain name." };

  if (value.length > 253) {
    return { ok: false, error: "That domain name is too long." };
  }

  // An IP address is a valid host but can never be a church's domain, and
  // accepting one would let a form point the tenant router at an arbitrary
  // address.
  if (/^[0-9.]+$/.test(value) || value.includes("[")) {
    return { ok: false, error: "Enter a domain name, not an IP address." };
  }

  const labels = value.split(".");

  if (labels.length < 2) {
    return {
      ok: false,
      error: "Enter a full domain, like gracechurch.org.",
    };
  }

  for (const label of labels) {
    if (!LABEL.test(label)) {
      return {
        ok: false,
        error: `"${value}" isn't a valid domain name.`,
      };
    }
  }

  // A TLD is never numeric, and this is the cheapest way to reject the
  // half-typed IP addresses that slip past the check above.
  if (/^[0-9]+$/.test(labels[labels.length - 1])) {
    return { ok: false, error: `"${value}" isn't a valid domain name.` };
  }

  if (BLOCKED_HOSTS.has(value)) {
    return { ok: false, error: "That domain can't be used." };
  }

  const rootHost = process.env.NEXT_PUBLIC_SITE_ROOT_HOST?.trim().toLowerCase();
  if (rootHost && (value === rootHost || value.endsWith(`.${rootHost}`))) {
    return {
      ok: false,
      error: `${rootHost} addresses are assigned by FaithForm — ask us to change your subdomain instead.`,
    };
  }

  return { ok: true, hostname: value, isApex: labels.length === 2 };
}

// ---------------------------------------------------------------------------
// THE RECORDS A CHURCH HAS TO ADD
// ---------------------------------------------------------------------------

/** Vercel's published anycast address; overridable for a different host. */
const A_TARGET = process.env.SITE_DNS_A_RECORD?.trim() || "76.76.21.21";
const CNAME_TARGET =
  process.env.SITE_DNS_CNAME_TARGET?.trim() || "cname.vercel-dns.com";

export type DnsRecord = {
  type: "A" | "CNAME";
  /** What goes in the registrar's "name"/"host" field. */
  name: string;
  value: string;
  /** Why this record exists, in words a pastor can act on. */
  note: string;
};

/**
 * The records for a hostname. An apex domain gets an A record because CNAME is
 * illegal at the zone root; anything deeper gets a CNAME.
 *
 * An apex request also returns the `www` CNAME, because a church that types
 * gracechurch.org expects www.gracechurch.org to work and will report it as
 * broken otherwise.
 */
export function dnsRecordsFor(hostname: string): DnsRecord[] {
  const labels = hostname.split(".");
  const isApex = labels.length === 2;

  if (isApex) {
    return [
      {
        type: "A",
        name: "@",
        value: A_TARGET,
        note: `Points ${hostname} at FaithForm.`,
      },
      {
        type: "CNAME",
        name: "www",
        value: CNAME_TARGET,
        note: `Makes www.${hostname} work too. Optional but recommended.`,
      },
    ];
  }

  return [
    {
      type: "CNAME",
      name: labels[0],
      value: CNAME_TARGET,
      note: `Points ${hostname} at FaithForm.`,
    },
  ];
}

// ---------------------------------------------------------------------------
// DNS CHECK
// ---------------------------------------------------------------------------

export type DnsCheckResult = {
  ok: boolean;
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

    const body = (await response.json()) as { Answer?: DohAnswer[] };
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
  const [cnames, addresses] = await Promise.all([
    resolve(hostname, DNS_TYPE_CNAME),
    resolve(hostname, DNS_TYPE_A),
  ]);

  if (cnames === null && addresses === null) {
    return {
      ok: false,
      detail: "Couldn't reach the DNS resolver. Try the check again shortly.",
    };
  }

  const cnameValues = (cnames ?? [])
    .filter((a) => a.type === DNS_TYPE_CNAME)
    .map((a) => stripDot(a.data));

  if (cnameValues.some((value) => value === stripDot(CNAME_TARGET))) {
    return { ok: true, detail: `CNAME points to ${CNAME_TARGET}.` };
  }

  const aValues = (addresses ?? [])
    .filter((a) => a.type === DNS_TYPE_A)
    .map((a) => a.data.trim());

  if (aValues.includes(A_TARGET)) {
    return { ok: true, detail: `A record points to ${A_TARGET}.` };
  }

  // An A record that resolved through a CNAME chain we do not recognise still
  // tells the church something useful, so report what is actually there.
  const found = [
    ...cnameValues.map((v) => `CNAME → ${v}`),
    ...aValues.map((v) => `A → ${v}`),
  ];

  if (found.length === 0) {
    return {
      ok: false,
      detail:
        "No DNS record found yet. New records can take up to an hour to spread.",
    };
  }

  return {
    ok: false,
    detail: `Found ${found.slice(0, 3).join(", ")} — expected ${CNAME_TARGET} or ${A_TARGET}.`,
  };
}

// ---------------------------------------------------------------------------
// PLATFORM PROVIDER
// ---------------------------------------------------------------------------

export type ProviderResult =
  | { ok: true; providerDomainId: string | null; serving: boolean }
  | { ok: false; error: string };

export type DomainProvider = {
  /** 'vercel' when automated, 'manual' when a person does it. */
  readonly name: "vercel" | "manual";
  /** True when the platform side happens automatically. */
  readonly automated: boolean;
  register(hostname: string): Promise<ProviderResult>;
  status(hostname: string): Promise<ProviderResult>;
  remove(hostname: string): Promise<ProviderResult>;
};

const manualProvider: DomainProvider = {
  name: "manual",
  automated: false,
  async register() {
    return { ok: true, providerDomainId: null, serving: false };
  },
  async status() {
    return { ok: true, providerDomainId: null, serving: false };
  },
  async remove() {
    return { ok: true, providerDomainId: null, serving: false };
  },
};

type VercelConfig = { token: string; projectId: string; teamId?: string };

function vercelConfig(): VercelConfig | null {
  const token = process.env.VERCEL_API_TOKEN?.trim();
  const projectId = process.env.VERCEL_PROJECT_ID?.trim();
  if (!token || !projectId) return null;
  return { token, projectId, teamId: process.env.VERCEL_TEAM_ID?.trim() };
}

function vercelUrl(config: VercelConfig, path: string): URL {
  const url = new URL(`https://api.vercel.com${path}`);
  if (config.teamId) url.searchParams.set("teamId", config.teamId);
  return url;
}

async function vercelFetch(
  config: VercelConfig,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const response = await fetch(vercelUrl(config, path), {
    ...init,
    headers: {
      authorization: `Bearer ${config.token}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });

  let body: Record<string, unknown> = {};
  try {
    body = (await response.json()) as Record<string, unknown>;
  } catch {
    // 204s and empty error bodies are both fine to treat as {}.
  }

  return { ok: response.ok, status: response.status, body };
}

function vercelError(body: Record<string, unknown>, fallback: string): string {
  const error = body.error as { message?: string } | undefined;
  return error?.message ?? fallback;
}

function makeVercelProvider(config: VercelConfig): DomainProvider {
  const base = `/v10/projects/${encodeURIComponent(config.projectId)}/domains`;

  /** Whether Vercel considers the hostname correctly pointed and serving. */
  async function serving(hostname: string): Promise<boolean> {
    const { ok, body } = await vercelFetch(
      config,
      `/v6/domains/${encodeURIComponent(hostname)}/config`,
    );
    // `misconfigured: false` is Vercel's "this hostname resolves to us".
    return ok && body.misconfigured === false;
  }

  return {
    name: "vercel",
    automated: true,

    async register(hostname) {
      const { ok, status, body } = await vercelFetch(config, base, {
        method: "POST",
        body: JSON.stringify({ name: hostname }),
      });

      // 409 means it is already on the project, which is the state we wanted.
      if (!ok && status !== 409) {
        return { ok: false, error: vercelError(body, "Vercel rejected the domain.") };
      }

      return {
        ok: true,
        providerDomainId: (body.name as string | undefined) ?? hostname,
        serving: await serving(hostname),
      };
    },

    async status(hostname) {
      const { ok, body } = await vercelFetch(
        config,
        `${base}/${encodeURIComponent(hostname)}`,
      );

      if (!ok) {
        return { ok: false, error: vercelError(body, "Domain is not on the project.") };
      }

      return {
        ok: true,
        providerDomainId: (body.name as string | undefined) ?? hostname,
        serving: await serving(hostname),
      };
    },

    async remove(hostname) {
      const { ok, status, body } = await vercelFetch(
        config,
        `${base}/${encodeURIComponent(hostname)}`,
        { method: "DELETE" },
      );

      // Already gone is the outcome we wanted.
      if (!ok && status !== 404) {
        return { ok: false, error: vercelError(body, "Vercel rejected the removal.") };
      }

      return { ok: true, providerDomainId: null, serving: false };
    },
  };
}

export function getDomainProvider(): DomainProvider {
  const config = vercelConfig();
  return config ? makeVercelProvider(config) : manualProvider;
}
