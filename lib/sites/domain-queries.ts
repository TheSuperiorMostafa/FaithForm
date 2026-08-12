import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Reads for the domain tables. Writes live in the two action files.
 *
 * Everything goes through the service-role client on purpose: `site_domains`
 * has no write policies at all and `site_domain_requests` only has SELECT, so
 * these are the only queries that can see the full picture (a church's own
 * request plus which hostnames are already claimed platform-wide).
 *
 * Every function tolerates the tables being absent. Migration 0043 exists
 * because an audit found 0014 and 0041 had never fully applied in production;
 * a website page that 500s on an unmigrated environment repeats that failure
 * in a louder way, so a missing table reads as "nothing requested yet".
 */

function isMissingDomainTable(message: string): boolean {
  return /site_domain_requests|site_domains/i.test(message);
}

/** Columns added by 0044. Absent on a database still on 0042. */
function isMissingDomainColumn(message: string): boolean {
  return /column .* does not exist/i.test(message);
}

// ---------------------------------------------------------------------------
// TYPES
// ---------------------------------------------------------------------------

export type DomainStatus = "pending_dns" | "dns_ok" | "live" | "failed";

export type SiteDomainDetail = {
  id: string;
  churchId: string;
  hostname: string;
  isPrimary: boolean;
  status: DomainStatus;
  verifiedAt: string | null;
  dnsCheckedAt: string | null;
  dnsDetail: string | null;
  provider: string;
  providerDomainId: string | null;
  notes: string | null;
  createdAt: string;
};

export type DomainRequestKind = "connect_existing" | "register_new";

export type DomainRequestStatus =
  | "submitted"
  | "in_review"
  | "awaiting_church"
  | "in_progress"
  | "completed"
  | "declined"
  | "cancelled";

/** Statuses that still count as work in the queue. Mirrors the partial index. */
export const OPEN_REQUEST_STATUSES: DomainRequestStatus[] = [
  "submitted",
  "in_review",
  "awaiting_church",
  "in_progress",
];

export function isOpenRequestStatus(status: DomainRequestStatus): boolean {
  return OPEN_REQUEST_STATUSES.includes(status);
}

export type SiteDomainRequest = {
  id: string;
  churchId: string;
  kind: DomainRequestKind;
  hostname: string | null;
  alternateHostnames: string[];
  registrar: string | null;
  contactName: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  notes: string | null;
  status: DomainRequestStatus;
  adminNotes: string | null;
  domainId: string | null;
  handledAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminDomainRequest = SiteDomainRequest & {
  churchName: string;
  churchSlug: string | null;
};

// ---------------------------------------------------------------------------
// MAPPERS
// ---------------------------------------------------------------------------

type Row = Record<string, unknown>;

function toDomain(row: Row): SiteDomainDetail {
  return {
    id: row.id as string,
    churchId: row.church_id as string,
    hostname: row.hostname as string,
    isPrimary: Boolean(row.is_primary),
    // Pre-0044 rows have no status column; a verified_at is the old "live".
    status:
      (row.status as DomainStatus | undefined) ??
      (row.verified_at ? "live" : "pending_dns"),
    verifiedAt: (row.verified_at as string | null) ?? null,
    dnsCheckedAt: (row.dns_checked_at as string | null) ?? null,
    dnsDetail: (row.dns_detail as string | null) ?? null,
    provider: (row.provider as string | null) ?? "manual",
    providerDomainId: (row.provider_domain_id as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    createdAt: row.created_at as string,
  };
}

function toRequest(row: Row): SiteDomainRequest {
  return {
    id: row.id as string,
    churchId: row.church_id as string,
    kind: row.kind as DomainRequestKind,
    hostname: (row.hostname as string | null) ?? null,
    alternateHostnames: (row.alternate_hostnames as string[] | null) ?? [],
    registrar: (row.registrar as string | null) ?? null,
    contactName: (row.contact_name as string | null) ?? null,
    contactEmail: (row.contact_email as string | null) ?? null,
    contactPhone: (row.contact_phone as string | null) ?? null,
    notes: (row.notes as string | null) ?? null,
    status: row.status as DomainRequestStatus,
    adminNotes: (row.admin_notes as string | null) ?? null,
    domainId: (row.domain_id as string | null) ?? null,
    handledAt: (row.handled_at as string | null) ?? null,
    createdAt: row.created_at as string,
    updatedAt: row.updated_at as string,
  };
}

const DOMAIN_COLUMNS =
  "id, church_id, hostname, is_primary, verified_at, created_at, " +
  "status, dns_checked_at, dns_detail, provider, provider_domain_id, notes";

/** The 0042 column set, for a database that has not received 0044 yet. */
const DOMAIN_COLUMNS_LEGACY =
  "id, church_id, hostname, is_primary, verified_at, created_at";

// ---------------------------------------------------------------------------
// CHURCH-FACING READS
// ---------------------------------------------------------------------------

export async function getChurchDomains(
  churchId: string,
): Promise<SiteDomainDetail[]> {
  const supabase = createAdminClient();

  const query = (columns: string) =>
    supabase
      .from("site_domains")
      .select(columns)
      .eq("church_id", churchId)
      .order("is_primary", { ascending: false })
      .order("created_at", { ascending: true });

  let { data, error } = await query(DOMAIN_COLUMNS);

  if (error && isMissingDomainColumn(error.message)) {
    ({ data, error } = await query(DOMAIN_COLUMNS_LEGACY));
  }

  if (error) {
    if (!isMissingDomainTable(error.message)) {
      console.error("getChurchDomains:", error.message);
    }
    return [];
  }

  return ((data ?? []) as unknown as Row[]).map(toDomain);
}

export async function getChurchDomainRequests(
  churchId: string,
): Promise<SiteDomainRequest[]> {
  const { data, error } = await createAdminClient()
    .from("site_domain_requests")
    .select("*")
    .eq("church_id", churchId)
    .order("created_at", { ascending: false });

  if (error) {
    if (!isMissingDomainTable(error.message)) {
      console.error("getChurchDomainRequests:", error.message);
    }
    return [];
  }

  return (data ?? []).map(toRequest);
}

/**
 * The request a church is currently waiting on, if any. Drives whether the
 * Domain page shows the two-path chooser or a status view.
 */
export async function getOpenDomainRequest(
  churchId: string,
): Promise<SiteDomainRequest | null> {
  const { data, error } = await createAdminClient()
    .from("site_domain_requests")
    .select("*")
    .eq("church_id", churchId)
    .in("status", OPEN_REQUEST_STATUSES)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    if (!isMissingDomainTable(error.message)) {
      console.error("getOpenDomainRequest:", error.message);
    }
    return null;
  }

  return data ? toRequest(data) : null;
}

/**
 * Whether a hostname is already spoken for, by this church or another.
 * `site_domains.hostname` is unique platform-wide, so the insert would fail
 * anyway — this exists to say so in words instead of surfacing a constraint
 * violation, and to catch a second church requesting a domain we have already
 * queued for someone else.
 */
export async function hostnameClaim(
  hostname: string,
): Promise<{ churchId: string; churchName: string } | null> {
  const supabase = createAdminClient();

  const { data: domain } = await supabase
    .from("site_domains")
    .select("church_id, churches(name)")
    .eq("hostname", hostname)
    .maybeSingle();

  if (domain?.church_id) {
    const church = domain.churches as { name?: string } | null;
    return {
      churchId: domain.church_id as string,
      churchName: church?.name ?? "another church",
    };
  }

  const { data: request } = await supabase
    .from("site_domain_requests")
    .select("church_id, churches(name)")
    .eq("hostname", hostname)
    .in("status", OPEN_REQUEST_STATUSES)
    .limit(1)
    .maybeSingle();

  if (request?.church_id) {
    const church = request.churches as { name?: string } | null;
    return {
      churchId: request.church_id as string,
      churchName: church?.name ?? "another church",
    };
  }

  return null;
}

// ---------------------------------------------------------------------------
// CONTROL-CENTER READS
// ---------------------------------------------------------------------------

export type DomainRequestFilter = "open" | "all" | DomainRequestStatus;

export async function listDomainRequests(
  filter: DomainRequestFilter = "open",
): Promise<AdminDomainRequest[]> {
  let query = createAdminClient()
    .from("site_domain_requests")
    .select("*, churches(name, slug)")
    .order("created_at", { ascending: filter === "open" });

  if (filter === "open") {
    query = query.in("status", OPEN_REQUEST_STATUSES);
  } else if (filter !== "all") {
    query = query.eq("status", filter);
  }

  const { data, error } = await query;

  if (error) {
    if (!isMissingDomainTable(error.message)) {
      console.error("listDomainRequests:", error.message);
    }
    return [];
  }

  return (data ?? []).map((row) => {
    const church = row.churches as { name?: string; slug?: string } | null;
    return {
      ...toRequest(row),
      churchName: church?.name ?? "Unknown church",
      churchSlug: church?.slug ?? null,
    };
  });
}

/** Drives the sidebar badge, so a request never sits unseen. */
export async function countOpenDomainRequests(): Promise<number> {
  const { count, error } = await createAdminClient()
    .from("site_domain_requests")
    .select("id", { count: "exact", head: true })
    .in("status", OPEN_REQUEST_STATUSES);

  if (error) {
    if (!isMissingDomainTable(error.message)) {
      console.error("countOpenDomainRequests:", error.message);
    }
    return 0;
  }

  return count ?? 0;
}

export type AdminSiteDomain = SiteDomainDetail & {
  churchName: string;
  churchSlug: string | null;
};

export async function listAllDomains(): Promise<AdminSiteDomain[]> {
  const supabase = createAdminClient();

  const query = (columns: string) =>
    supabase
      .from("site_domains")
      .select(`${columns}, churches(name, slug)`)
      .order("created_at", { ascending: false });

  let { data, error } = await query(DOMAIN_COLUMNS);

  if (error && isMissingDomainColumn(error.message)) {
    ({ data, error } = await query(DOMAIN_COLUMNS_LEGACY));
  }

  if (error) {
    if (!isMissingDomainTable(error.message)) {
      console.error("listAllDomains:", error.message);
    }
    return [];
  }

  return ((data ?? []) as unknown as Row[]).map((row) => {
    const church = row.churches as { name?: string; slug?: string } | null;
    return {
      ...toDomain(row),
      churchName: church?.name ?? "Unknown church",
      churchSlug: church?.slug ?? null,
    };
  });
}
