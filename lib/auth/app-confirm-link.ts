import { getCanonicalSiteUrl } from "@/lib/site-url";
import { FAITHFORM_MOBILE_CALLBACK } from "@/lib/auth/auth-redirects";

/**
 * The https page a FaithForm confirmation email comes back to, and the rule
 * for handing what it carries on to the app.
 *
 * ## Why this exists
 *
 * The apps used to register `faithform://auth/callback` as the confirmation
 * `redirect_to` directly, on the assumption that the OS would open the app with
 * no browser page as a final stop. It does not. Supabase's verify endpoint
 * confirms the address and *then* answers `302 Location: faithform://…`, and a
 * browser asked to follow a redirect into a non-http scheme generally refuses —
 * the in-app browsers inside mail clients always do. So the last thing a person
 * saw after confirming was a connection error, on an account that had in fact
 * been confirmed a moment earlier. Signing in by hand worked, which is exactly
 * why the bug looked cosmetic and was not.
 *
 * An https page can receive that redirect. From there the hand-off to the
 * custom scheme is a navigation the *page* initiates, which browsers do allow,
 * and when nothing happens there is somewhere to say so in words.
 *
 * ## What this page may not do
 *
 * Exchange the code. The PKCE verifier that would spend it is in the phone's
 * keychain and never leaves it, so a code passing through here is worthless to
 * this server and to anyone who intercepts the page. The page is a courier.
 *
 * Mirrors `confirmHandoff` in `contracts/faithform/v1/auth-callback.json`;
 * `tests/unit/app-confirm-link.test.ts` drives this from the contract's own
 * vectors, as the Swift and Kotlin suites do for their halves.
 */

/** Where the apps' confirmation emails land, relative to an origin. */
export const APP_CONFIRM_PATH = "/app/auth/callback";

/** Bounds from the contract: what a provider-minted code may look like. */
const CODE = /^[A-Za-z0-9._~-]{8,512}$/;

/** What a provider failure may be named — see `reason` below. */
const REASON = /^[a-z][a-z0-9_]{0,63}$/;

/** This build's absolute confirmation landing page. */
export function appConfirmRedirect(): string {
  return `${getCanonicalSiteUrl()}${APP_CONFIRM_PATH}`;
}

/**
 * What the arriving URL amounts to, as a state the page can render.
 *
 * Three outcomes, because the page has three honest things to say. A code
 * means the address was confirmed a moment ago and the app can finish. A
 * failure means the provider refused the link, and saying "you're confirmed"
 * there would be a lie. Nothing at all means the link carried no state — it
 * was probably already opened once — and the way forward is an ordinary
 * sign-in.
 */
export type AppCallbackHandoff =
  | { kind: "code"; link: string }
  | { kind: "failure"; link: string }
  | { kind: "nothing"; link: null };

/**
 * Reads both halves of the location, because providers are not consistent
 * about which one they use: a code arrives in the query, a failure arrives in
 * the fragment, and some versions put a failure in the query too. A failure is
 * always emitted back in the fragment, which is the form both app parsers were
 * written against first.
 */
export function readAppCallback(search: string, hash: string): AppCallbackHandoff {
  const query = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const fragment = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);

  const pick = (name: string) => query.get(name) ?? fragment.get(name);

  // A reported failure outranks a code: a provider that says "expired" and
  // leaves a stale code on the URL must not be read as a success.
  const error = reason(pick("error"));
  const errorCode = reason(pick("error_code"));
  if (error || errorCode) {
    const parts: string[] = [];
    if (error) parts.push(`error=${error}`);
    if (errorCode) parts.push(`error_code=${errorCode}`);
    return { kind: "failure", link: `${FAITHFORM_MOBILE_CALLBACK}#${parts.join("&")}` };
  }

  const code = pick("code");
  if (!code || !CODE.test(code)) return { kind: "nothing", link: null };

  return { kind: "code", link: `${FAITHFORM_MOBILE_CALLBACK}?code=${code}` };
}

/**
 * The deep link alone, or null when the arriving URL carries nothing the app
 * could act on — in which case the page explains rather than bouncing someone
 * into an app that would only show "this link is invalid".
 */
export function buildAppCallbackLink(search: string, hash: string): string | null {
  return readAppCallback(search, hash).link;
}

/**
 * Narrow on purpose: these two values are the only part of a provider's error
 * that crosses into the deep link, so confining them to a lowercase identifier
 * means no wording, address, or punctuation from an error description can
 * shape the URL we navigate to.
 */
function reason(value: string | null): string | null {
  return value && REASON.test(value) ? value : null;
}
