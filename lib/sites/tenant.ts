import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

/**
 * Tenant resolution: incoming hostname -> which church's site to render.
 *
 * Runs in middleware on every request, so the cheap paths come first. A
 * subdomain of the site root host is parsed from the string with no I/O at
 * all; only a genuinely foreign hostname costs a database lookup, and that
 * result is cached.
 */

/** Paths that are never a church site, whatever host they arrive on. */
function isReservedPath(pathname: string): boolean {
  return (
    pathname.startsWith("/api/") ||
    pathname.startsWith("/_next/") ||
    pathname.startsWith("/sites/") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml"
  );
}

/**
 * Subdomains that belong to the platform, not to a church. `give` is already
 * claimed by rewriteGiveSubdomain; the rest are reserved so a church can never
 * be provisioned onto a hostname that shadows platform infrastructure.
 */
const RESERVED_SUBDOMAINS = new Set([
  "www",
  "app",
  "api",
  "give",
  "admin",
  "dashboard",
  "auth",
  "login",
  "mail",
  "static",
  "assets",
  "cdn",
  "staging",
  "preview",
]);

const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

function hostOf(request: NextRequest): string {
  return (request.headers.get("host") ?? "").split(":")[0].toLowerCase();
}

/** The app's own hostnames, which must keep serving the dashboard. */
function platformHosts(): string[] {
  const hosts: string[] = [];

  const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
  if (siteUrl) {
    try {
      hosts.push(new URL(siteUrl).hostname.toLowerCase());
    } catch {
      // A malformed env value should not take tenant routing down with it.
    }
  }

  const giveHost = process.env.NEXT_PUBLIC_GIVE_HOST?.trim().toLowerCase();
  if (giveHost) hosts.push(giveHost.split(":")[0]);

  hosts.push("localhost", "127.0.0.1");

  const vercelUrl = process.env.VERCEL_PROJECT_PRODUCTION_URL?.toLowerCase();
  if (vercelUrl) hosts.push(vercelUrl.split(":")[0]);

  return hosts;
}

/**
 * Extracts `grace` from `grace.faithform.io` when NEXT_PUBLIC_SITE_ROOT_HOST is
 * `faithform.io`. Returns null for the bare root, for reserved names, and for
 * anything deeper than one label.
 */
export function subdomainSlug(host: string): string | null {
  const rootHost = process.env.NEXT_PUBLIC_SITE_ROOT_HOST?.trim().toLowerCase();
  if (!rootHost || host === rootHost) return null;
  if (!host.endsWith(`.${rootHost}`)) return null;

  const label = host.slice(0, -(rootHost.length + 1));
  if (!label || label.includes(".")) return null;
  if (RESERVED_SUBDOMAINS.has(label)) return null;
  if (!SLUG_PATTERN.test(label)) return null;

  return label;
}

// ---------------------------------------------------------------------------
// CUSTOM DOMAIN CACHE
// ---------------------------------------------------------------------------

type CacheEntry = { slug: string | null; expiresAt: number };

/**
 * Per-instance memo for hostname lookups. Middleware runs on every request and
 * a domain mapping changes roughly never, so this turns the common case into
 * zero round trips. Misses are cached too -- otherwise traffic to a hostname
 * that is not ours becomes a database query per request.
 */
const domainCache = new Map<string, CacheEntry>();
const HIT_TTL_MS = 5 * 60 * 1000;
const MISS_TTL_MS = 60 * 1000;
const MAX_CACHE_ENTRIES = 500;

function readCache(host: string): CacheEntry | null {
  const entry = domainCache.get(host);
  if (!entry) return null;
  if (entry.expiresAt < Date.now()) {
    domainCache.delete(host);
    return null;
  }
  return entry;
}

function writeCache(host: string, slug: string | null): void {
  // Unbounded growth would be a memory leak fed by arbitrary Host headers.
  if (domainCache.size >= MAX_CACHE_ENTRIES) domainCache.clear();

  domainCache.set(host, {
    slug,
    expiresAt: Date.now() + (slug ? HIT_TTL_MS : MISS_TTL_MS),
  });
}

/**
 * Looks a custom domain up over PostgREST rather than through the Supabase
 * client, because middleware runs on the edge runtime and this keeps the
 * dependency to a single fetch.
 */
async function lookupCustomDomain(host: string): Promise<string | null> {
  const cached = readCache(host);
  if (cached) return cached.slug;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) return null;

  try {
    const endpoint = new URL("/rest/v1/site_domains", url);
    endpoint.searchParams.set("select", "churches(slug)");
    endpoint.searchParams.set("hostname", `eq.${host}`);
    endpoint.searchParams.set("limit", "1");

    const response = await fetch(endpoint, {
      headers: { apikey: key, Authorization: `Bearer ${key}` },
      cache: "no-store",
    });

    if (!response.ok) {
      writeCache(host, null);
      return null;
    }

    const rows = (await response.json()) as { churches?: { slug?: string } }[];
    const slug = rows?.[0]?.churches?.slug ?? null;

    writeCache(host, slug);
    return slug;
  } catch (error) {
    console.error("[sites] domain lookup failed:", error);
    // Not cached: a transient network failure should not pin this hostname to
    // a 404 for the next minute.
    return null;
  }
}

// ---------------------------------------------------------------------------
// REWRITE
// ---------------------------------------------------------------------------

/**
 * Rewrites a church hostname onto /sites/<slug>. Returns null when the request
 * is not for a church site, in which case the caller carries on to the normal
 * app middleware.
 *
 * Called before the Supabase auth client is created so that public site traffic
 * never pays for a session round trip -- the same ordering rewriteGiveSubdomain
 * already relies on.
 */
export async function rewriteChurchSite(
  request: NextRequest,
): Promise<NextResponse | null> {
  const { pathname } = request.nextUrl;
  if (isReservedPath(pathname)) return null;

  const host = hostOf(request);
  if (!host || platformHosts().includes(host)) return null;

  const slug = subdomainSlug(host) ?? (await lookupCustomDomain(host));
  if (!slug) return null;

  const url = request.nextUrl.clone();
  url.pathname = `/sites/${slug}${pathname === "/" ? "" : pathname}`;
  return NextResponse.rewrite(url);
}
