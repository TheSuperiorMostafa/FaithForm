/**
 * Reading a password-reset link that arrived with its session in the fragment.
 *
 * ## Why a reset link can arrive this way at all
 *
 * The dashboard asks Supabase for a reset link with PKCE, so its links come
 * back as `/auth/callback?code=…` and are exchanged on the server. The phone
 * apps ask without a PKCE challenge — the verifier would have to live in a
 * browser the app does not control — and Supabase answers a non-PKCE request
 * with the implicit flow: the session itself, in the URL fragment.
 *
 *   /auth/callback?next=…#access_token=…&refresh_token=…&type=recovery
 *
 * A fragment never reaches a server. The callback route sees no code and no
 * error, and the only thing that can read the tokens is script running on the
 * page. So the route hands that case to `/auth/confirm`, and this module is the
 * part of that page that decides what the fragment says.
 *
 * ## Why `type` and not the token's `amr` claim
 *
 * The code path trusts `sessionCameFromRecovery`, which reads `amr`. That claim
 * is stamped by the PKCE exchange from the flow it completes; a session minted
 * directly by the implicit verify cannot be relied on to say `recovery` there.
 * The fragment's own `type=recovery` is what Supabase writes for this flow, and
 * `setSession` still verifies both tokens against our project before anything
 * is signed in, so a forged fragment gets no further than a real one would.
 */

export type RecoveryFragment =
  | { kind: "recovery"; accessToken: string; refreshToken: string }
  | { kind: "invalid" };

const INVALID: RecoveryFragment = { kind: "invalid" };

/** Three base64url segments. `setSession` decodes the payload before it asks. */
const JWT_SHAPE = /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*$/;

/** Supabase refresh tokens are opaque, but never blank and never spaced. */
const REFRESH_SHAPE = /^[A-Za-z0-9_\-.~]+$/;

/**
 * Defensive ceilings. A real access token is a couple of kilobytes at most;
 * anything far beyond that is not one, and is not worth handing to a parser.
 */
const MAX_ACCESS_TOKEN = 8192;
const MAX_REFRESH_TOKEN = 1024;

function fragmentParams(hash: string | null | undefined): URLSearchParams | null {
  if (!hash) return null;
  const body = hash.startsWith("#") ? hash.slice(1) : hash;
  if (!body) return null;
  return new URLSearchParams(body);
}

/**
 * What a reset link's fragment amounts to.
 *
 * Only a recovery session is accepted. A reported error, a magic-link or signup
 * session, a truncated token — all of them are `invalid`, which the page turns
 * into the same "that link did not work" the callback shows today.
 */
export function readRecoveryFragment(hash: string | null | undefined): RecoveryFragment {
  const params = fragmentParams(hash);
  if (!params) return INVALID;

  // Supabase reports an expired or spent link in the fragment too. An error
  // alongside tokens is still an error.
  if (params.has("error") || params.has("error_code") || params.has("error_description")) {
    return INVALID;
  }

  if (params.get("type") !== "recovery") return INVALID;

  const accessToken = params.get("access_token") ?? "";
  const refreshToken = params.get("refresh_token") ?? "";

  if (
    accessToken.length === 0 ||
    accessToken.length > MAX_ACCESS_TOKEN ||
    !JWT_SHAPE.test(accessToken)
  ) {
    return INVALID;
  }
  if (
    refreshToken.length === 0 ||
    refreshToken.length > MAX_REFRESH_TOKEN ||
    !REFRESH_SHAPE.test(refreshToken)
  ) {
    return INVALID;
  }

  return { kind: "recovery", accessToken, refreshToken };
}

/**
 * Whether a fragment looks like something Supabase put there — a session or a
 * reported failure — as opposed to an ordinary in-page anchor.
 *
 * Used where a link can land after Supabase threw its path away (the bare Site
 * URL, which redirects on to `/login`): only an auth fragment is worth moving
 * to `/auth/confirm`.
 */
export function isAuthFragment(hash: string | null | undefined): boolean {
  const params = fragmentParams(hash);
  if (!params) return false;
  return (
    params.has("access_token") ||
    params.has("error_description") ||
    params.has("error_code")
  );
}

/**
 * Whether `/auth/callback` should hand the request to `/auth/confirm` instead
 * of calling it a failure.
 *
 * Only when there is nothing on the query string to act on: no code to exchange
 * and no failure the provider already reported. Either of those is a decision
 * the server can make, and makes, without script. What is left is exactly the
 * arrival whose answer — if there is one — is in the fragment.
 */
export function callbackNeedsFragmentHandoff(params: URLSearchParams): boolean {
  if (params.get("code")) return false;
  return !(
    params.has("error") ||
    params.has("error_code") ||
    params.has("error_description")
  );
}
