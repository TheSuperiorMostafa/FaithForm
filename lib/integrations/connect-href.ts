/**
 * Links that start an account sign-in directly, so a "Reconnect" prompt
 * anywhere in the dashboard goes straight to Google or Facebook and comes back
 * to the page it was pressed on, without a stop in Settings first.
 *
 * Client-safe: no server imports. The connect routes still check admin access
 * and validate `return_to` (see `safeReturnTo`).
 */

export type OAuthAccount = "google" | "youtube" | "facebook";

const CONNECT_PATHS: Record<OAuthAccount, string> = {
  google: "/api/integrations/google/connect",
  youtube: "/api/integrations/youtube/connect",
  facebook: "/api/integrations/facebook/connect",
};

/** Where the iCloud row lives: it signs in with an app password, not a redirect. */
export const APPLE_ACCOUNT_HREF = "/dashboard/settings?tab=accounts&account=apple";

/**
 * The URL that starts the sign-in for `account` and returns to `returnTo`.
 * `returnTo` must be an app-relative path; anything else is dropped and the
 * route falls back to Settings.
 */
export function integrationConnectHref(account: OAuthAccount, returnTo?: string | null): string {
  const path = CONNECT_PATHS[account];
  const safe = returnTo && /^\/(?![/\\])/.test(returnTo) ? returnTo : null;
  return safe ? `${path}?return_to=${encodeURIComponent(safe)}` : path;
}
