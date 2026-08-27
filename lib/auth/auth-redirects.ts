import { getCanonicalSiteUrl } from "@/lib/site-url";
import { safeRedirectPath } from "@/lib/security/safe-redirect";

/**
 * Every post-auth destination this product will ever hand an identity provider.
 *
 * Two surfaces, two destinations, and no third: the church dashboard finishes
 * on its own web callback, and the Faithful app finishes inside the app on its
 * custom scheme. Neither may be reached from the other, and **neither is ever
 * taken from a request**: the value is derived from this build's configured
 * origin (dashboard) or from a compiled-in constant (app).
 *
 * Mirrors `contracts/faithful/v1/auth-callback.json`, which the iOS and Android
 * suites read as well; `tests/unit/auth-redirect-contract.test.ts` asserts the
 * two never drift.
 */

/** The dashboard's own callback route. */
export const DASHBOARD_CALLBACK_PATH = "/auth/callback";

/**
 * The Faithful app's callback. Declared here only so this module can *refuse*
 * it as a dashboard destination — the web app never sends anyone here.
 */
export const FAITHFUL_MOBILE_CALLBACK = "faithful://auth/callback";

/**
 * The absolute dashboard callback for this environment, optionally carrying a
 * post-auth path.
 *
 * `next` is sanitised through `safeRedirectPath`, so a caller cannot smuggle an
 * absolute URL, a protocol-relative path, or the app's custom scheme into an
 * emailed link. The origin comes from configuration, never from the request.
 */
export function dashboardEmailRedirect(next?: string): string {
  const origin = getCanonicalSiteUrl();
  if (next === undefined) return `${origin}${DASHBOARD_CALLBACK_PATH}`;

  const safeNext = safeRedirectPath(next);
  return `${origin}${DASHBOARD_CALLBACK_PATH}?next=${encodeURIComponent(safeNext)}`;
}

/**
 * Whether a redirect a *provider* handed back is one this dashboard issued.
 *
 * Used to check configuration, not to authorize a request: a URL that fails
 * this is a sign the Supabase project's allow-list or Site URL points somewhere
 * this build did not choose.
 */
export function isAllowedDashboardRedirect(candidate: string): boolean {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return false;
  }

  // The app's custom scheme is a legitimate destination — for the app. It is
  // never a dashboard one, and treating it as such is the exact confusion that
  // sent Faithful's confirmation emails into the staff dashboard.
  if (url.protocol !== "https:" && url.protocol !== "http:") return false;

  const origin = getCanonicalSiteUrl();
  let expected: URL;
  try {
    expected = new URL(DASHBOARD_CALLBACK_PATH, origin);
  } catch {
    return false;
  }

  return url.origin === expected.origin && url.pathname === expected.pathname;
}

/** Whether a string is the Faithful app's callback, in any case form. */
export function isFaithfulMobileCallback(candidate: string): boolean {
  try {
    const url = new URL(candidate);
    return (
      url.protocol.toLowerCase() === "faithful:" &&
      url.host.toLowerCase() === "auth" &&
      url.pathname === "/callback"
    );
  } catch {
    return false;
  }
}
