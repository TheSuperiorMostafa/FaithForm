/**
 * Pure helpers behind the church website's "now live" banner and /live page.
 *
 * Kept free of server imports so the client banner and unit tests can share
 * them with the server-side status read in `live-status.ts`.
 */

/** The only fields the public website ever learns about a broadcast. */
export type SiteLiveStatus = {
  live: boolean;
  eventTitle: string | null;
};

export const OFFLINE_SITE_LIVE_STATUS: SiteLiveStatus = { live: false, eventTitle: null };

/** Session states that count as on-air once the encoder is actually sending. */
const ON_AIR_SESSION_STATES = new Set(["live", "waiting_for_encoder", "preparing"]);

/**
 * Same rule the public player uses (app/api/stream/public-status) to decide it
 * has something to play, narrowed to broadcasts a visitor can actually watch:
 * a public event must exist, otherwise the player has no playback URL and the
 * banner would promise a stream that shows "offline".
 */
export function isPubliclyLive(input: {
  sessionStatus: string | null | undefined;
  ingestStartedAt: string | null | undefined;
  previewIngestActive: boolean;
  hasPublicEvent: boolean;
}): boolean {
  if (!input.hasPublicEvent) return false;
  if (!input.sessionStatus || !ON_AIR_SESSION_STATES.has(input.sessionStatus)) return false;
  return input.previewIngestActive || Boolean(input.ingestStartedAt);
}

/** The site's own watch page, on either the church domain or /sites/<slug>. */
export function siteLiveHref(basePath: string, preview: boolean): string {
  return `${basePath}/live${preview ? "?preview=1" : ""}`;
}

/** The site's home page, mirroring how the nav builds its home link. */
export function siteHomeHref(basePath: string, preview: boolean): string {
  return `${basePath || "/"}${preview ? "?preview=1" : ""}`;
}

/** Status endpoint the banner polls. Same origin on custom domains: /api is never rewritten. */
export function siteLiveStatusUrl(slug: string): string {
  return `/api/sites/live-status?slug=${encodeURIComponent(slug)}`;
}

export const SITE_LIVE_POLL_VISIBLE_MS = 30_000;
export const SITE_LIVE_POLL_HIDDEN_MS = 120_000;
const SITE_LIVE_POLL_MAX_MS = 300_000;

/**
 * Banner poll cadence. Every site visitor runs this, so it is deliberately
 * slower than the player's own poll, idles in background tabs, and backs off
 * while the endpoint is failing.
 */
export function siteLivePollDelay(hidden: boolean, failures: number): number {
  const base = hidden ? SITE_LIVE_POLL_HIDDEN_MS : SITE_LIVE_POLL_VISIBLE_MS;
  const exponent = Math.max(0, Math.min(Math.floor(failures), 4));
  return Math.min(base * 2 ** exponent, SITE_LIVE_POLL_MAX_MS);
}

/** Accepts only the expected public shape; anything else reads as offline. */
export function parseSiteLiveStatus(value: unknown): SiteLiveStatus | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (typeof record.live !== "boolean") return null;
  const title = typeof record.eventTitle === "string" ? record.eventTitle.trim() : "";
  return { live: record.live, eventTitle: record.live && title ? title.slice(0, 200) : null };
}

/** "Grace Church is now live" — falls back gracefully for an unnamed church. */
export function liveBannerHeadline(churchName: string | null | undefined): string {
  const name = churchName?.trim();
  return name ? `${name} is now live` : "We're live now";
}
