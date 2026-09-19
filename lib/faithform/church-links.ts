/**
 * The church's own links, as the member app shows them: social profiles and
 * the quick links a church chooses to feature.
 *
 * One module owns the rules so the dashboard that saves them and the API that
 * serves them cannot disagree. Everything that leaves here is an absolute
 * http(s) URL — a phone opens these directly, so `javascript:`, `tel:` or a
 * relative path must never survive normalization.
 */

export const SOCIAL_PLATFORMS = [
  {
    key: "instagram",
    column: "instagram_url",
    label: "Instagram",
    handleBase: "https://instagram.com/",
    placeholder: "@yourchurch",
  },
  {
    key: "facebook",
    column: "facebook_url",
    label: "Facebook",
    handleBase: "https://facebook.com/",
    placeholder: "facebook.com/yourchurch",
  },
  {
    key: "youtube",
    column: "youtube_url",
    label: "YouTube",
    handleBase: "https://youtube.com/@",
    placeholder: "@yourchurch",
  },
  {
    key: "tiktok",
    column: "tiktok_url",
    label: "TikTok",
    handleBase: "https://tiktok.com/@",
    placeholder: "@yourchurch",
  },
  {
    key: "x",
    column: "x_url",
    label: "X",
    handleBase: "https://x.com/",
    placeholder: "@yourchurch",
  },
  {
    key: "podcast",
    column: "podcast_url",
    label: "Podcast",
    // A podcast has no handle convention; it must be a full link.
    handleBase: null,
    placeholder: "Apple Podcasts or Spotify link",
  },
] as const;

export type SocialPlatformKey = (typeof SOCIAL_PLATFORMS)[number]["key"];
export type SocialColumn = (typeof SOCIAL_PLATFORMS)[number]["column"];

export const SOCIAL_COLUMNS = SOCIAL_PLATFORMS.map((platform) => platform.column);

export type ChurchSocialLink = { platform: SocialPlatformKey; url: string };
export type ChurchQuickLink = { label: string; url: string };

export const MAX_QUICK_LINKS = 8;
export const MAX_QUICK_LINK_LABEL = 40;

const HANDLE = /^[A-Za-z0-9._-]{1,100}$/;

function asHttpUrl(candidate: string): string | null {
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    if (!parsed.hostname.includes(".")) return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

/**
 * Accepts what a church actually pastes — a full link, a bare domain, or a
 * handle — and returns an absolute URL, or null when it cannot be one.
 */
export function normalizeWebUrl(raw: string | null | undefined): string | null {
  const value = raw?.trim();
  if (!value) return null;
  if (/^https?:\/\//i.test(value)) return asHttpUrl(value);
  // "www.grace.church" or "grace.church/visit": a domain without a scheme.
  if (/^[^\s/:]+\.[^\s/:]+/.test(value) && !value.includes("@")) {
    return asHttpUrl(`https://${value}`);
  }
  return null;
}

export function normalizeSocialUrl(
  platform: SocialPlatformKey,
  raw: string | null | undefined,
): string | null {
  const value = raw?.trim();
  if (!value) return null;

  const asUrl = normalizeWebUrl(value);
  if (asUrl) return asUrl;

  const definition = SOCIAL_PLATFORMS.find((entry) => entry.key === platform);
  if (!definition?.handleBase) return null;

  const handle = value.replace(/^@/, "");
  if (!HANDLE.test(handle)) return null;
  return `${definition.handleBase}${handle}`;
}

/** Social links in display order, from a `churches` row. Invalid values are dropped. */
export function socialLinksFromRow(row: Record<string, unknown>): ChurchSocialLink[] {
  const links: ChurchSocialLink[] = [];
  for (const platform of SOCIAL_PLATFORMS) {
    const url = normalizeSocialUrl(platform.key, row[platform.column] as string | null);
    if (url) links.push({ platform: platform.key, url });
  }
  return links;
}

/**
 * Quick links from the `app_links` column. Tolerant on read — a malformed
 * entry is skipped rather than failing the whole church page.
 */
export function parseQuickLinks(raw: unknown): ChurchQuickLink[] {
  if (!Array.isArray(raw)) return [];
  const links: ChurchQuickLink[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const label = typeof record.label === "string" ? record.label.trim() : "";
    const url = normalizeWebUrl(typeof record.url === "string" ? record.url : null);
    if (!label || !url) continue;
    links.push({ label: label.slice(0, MAX_QUICK_LINK_LABEL), url });
    if (links.length >= MAX_QUICK_LINKS) break;
  }
  return links;
}

/**
 * Everything on a church's app page beyond the discovery profile: the longer
 * "about", a maps link, social profiles, featured links, and the service times
 * a church recorded for itself as a whole rather than for one campus.
 */
export type ChurchAppDetails = {
  about: string | null;
  mapsUrl: string | null;
  socialLinks: ChurchSocialLink[];
  quickLinks: ChurchQuickLink[];
  churchWideServices: { label: string; dayOfWeek: number; startTime: string; kind: string }[];
};

/** One mapping for both read paths — the public projection and the member read. */
export function appDetailsFrom(
  row: Record<string, unknown>,
  services: Record<string, unknown>[],
): ChurchAppDetails {
  return {
    about: (row.description as string | null)?.trim() || null,
    mapsUrl: normalizeWebUrl(row.google_maps_url as string | null),
    socialLinks: socialLinksFromRow(row),
    quickLinks: parseQuickLinks(row.app_links),
    churchWideServices: services.map((service) => ({
      label: service.label as string,
      dayOfWeek: Number(service.day_of_week),
      startTime: String(service.start_time),
      kind: service.kind as string,
    })),
  };
}
