/**
 * Canonical public app URL for links in emails, OAuth, give pages, etc.
 * Never use VERCEL_URL here — it is a per-deployment hostname.
 */

/** Hostnames that must not be used unless explicitly configured by the church operator. */
const BLOCKED_SITE_HOSTS = new Set([
  "faithform.app",
  "faithform.vercel.app",
  "give.faithform.com",
  "faithform.com",
  "www.faithform.com",
]);

function normalizeUrl(url: string): string {
  return url.replace(/\/$/, "");
}

function isUsableSiteUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname.toLowerCase();
    return !BLOCKED_SITE_HOSTS.has(host);
  } catch {
    return false;
  }
}

/** Stable Vercel project URL — always works without a custom domain. */
export const DEFAULT_PRODUCTION_SITE_URL = "https://faithform.io";

export function getCanonicalSiteUrl(): string {
  const candidates = [
    process.env.NEXT_PUBLIC_SITE_URL,
    process.env.SITE_URL,
    process.env.INVITE_SITE_URL,
    process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : undefined,
  ];

  for (const raw of candidates) {
    if (!raw) continue;
    const url = normalizeUrl(raw);
    if (isUsableSiteUrl(url)) return url;
  }

  if (process.env.NODE_ENV === "production") {
    return DEFAULT_PRODUCTION_SITE_URL;
  }

  return "http://localhost:3000";
}

export function absoluteAppPath(path: string): string {
  const normalized = path.startsWith("/") ? path : `/${path}`;
  return `${getCanonicalSiteUrl()}${normalized}`;
}

/**
 * Public church give page: {site}/give/{slug}
 * Optional dedicated subdomain only when NEXT_PUBLIC_GIVE_USE_DEDICATED_HOST=true.
 */
export function getGivePageUrl(slug: string): string {
  const useDedicated =
    process.env.NEXT_PUBLIC_GIVE_USE_DEDICATED_HOST === "true";
  const dedicatedHost = process.env.NEXT_PUBLIC_GIVE_HOST?.trim();

  if (useDedicated && dedicatedHost) {
    const protocol =
      process.env.NODE_ENV === "production" ? "https" : "http";
    if (dedicatedHost.includes("localhost")) {
      return `${protocol}://${dedicatedHost}/give/${slug}`;
    }
    return `https://${dedicatedHost}/${slug}`;
  }

  return absoluteAppPath(`/give/${slug}`);
}
