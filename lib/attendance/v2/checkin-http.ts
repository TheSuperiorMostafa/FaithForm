import { cookies } from "next/headers";

import { checkRateLimit, getClientIp } from "@/lib/security/rate-limit";

/**
 * The HTTP edges of the check-in surface: cookies, budgets, and safe replies.
 *
 * ## Why these cookies are scoped the way they are
 *
 * Both cookies are set at `path=/api/checkin`. That is not tidiness — it is the
 * blast radius. A projector's capability is never sent to `/dashboard`, a
 * kiosk's is never sent to `/api/mobile`, and neither reaches anything that
 * could act on a church's behalf. `SameSite=Strict` means another site cannot
 * cause the browser to spend one, and `httpOnly` means a script on the page
 * cannot read one out to send somewhere else.
 *
 * The page at `/checkin/display` holds no cookie itself. It renders the pairing
 * form, calls the API, and switches to the projector view when the API answers —
 * so a server-rendered page never needs the capability and never embeds it.
 *
 * ## What is not solved here, stated plainly
 *
 * These cookies do not stop a **dashboard** session existing in the same
 * browser. Nothing at this layer could: Supabase's auth cookies are set at `/`
 * and go wherever the browser goes. What the pairing flow provides is the
 * ability to run a display on a machine that was **never signed in** — and that
 * is the operational instruction in the runbook, not a guarantee this code can
 * enforce.
 */

export const DISPLAY_COOKIE = "ff_checkin_display";
export const KIOSK_COOKIE = "ff_checkin_kiosk";

const COOKIE_PATH = "/api/checkin";

export async function setCheckinCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
): Promise<void> {
  const store = await cookies();
  store.set(name, value, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Strict rather than lax: nothing should ever arrive here as a result of
    // following a link from somewhere else.
    sameSite: "strict",
    maxAge: Math.max(60, Math.floor(maxAgeSeconds)),
    path: COOKIE_PATH,
  });
}

export async function clearCheckinCookie(name: string): Promise<void> {
  const store = await cookies();
  store.set(name, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 0,
    path: COOKIE_PATH,
  });
}

export async function readCheckinCookie(name: string): Promise<string | null> {
  const store = await cookies();
  const value = store.get(name)?.value;
  if (!value || value.length > 2048) return null;
  return value;
}

/**
 * Never storable, never shared, and never revealing a code in a URL.
 *
 * Everything on this surface is either a live rotating capability or a person's
 * name, and neither belongs in a cache.
 */
export function checkinJson(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store, no-cache, must-revalidate, private",
      Pragma: "no-cache",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/**
 * The budget for an endpoint that accepts a typed code.
 *
 * Two buckets, because neither is sufficient alone:
 *
 *   * **Per client**, which is the one that matters — except that
 *     `getClientIp` honestly returns `"untrusted"` unless the deployment
 *     declares a trusted proxy, so off-Vercel every caller shares one bucket.
 *     That is a real limitation of the existing limiter and is recorded rather
 *     than papered over.
 *   * **Per endpoint, globally**, as the backstop that still holds when the
 *     first collapses. It is set well above any plausible church's use and far
 *     below what a search of a 31-bit space would need.
 *
 * `checkRateLimit` fails closed, so an unavailable limiter refuses the pairing
 * rather than allowing it.
 */
export async function throttleTypedCode(
  request: Request,
  scope: string,
): Promise<{ ok: true } | { ok: false; retryAfterSeconds: number }> {
  const ip = getClientIp(request);

  const perClient = await checkRateLimit(`checkin:${scope}:client:${ip}`, {
    limit: 12,
    windowMs: 5 * 60 * 1000,
  });
  if (!perClient.ok) return { ok: false, retryAfterSeconds: perClient.retryAfterSeconds };

  const global = await checkRateLimit(`checkin:${scope}:global`, {
    limit: 400,
    windowMs: 5 * 60 * 1000,
  });
  if (!global.ok) return { ok: false, retryAfterSeconds: global.retryAfterSeconds };

  return { ok: true };
}

/** A bounded JSON body. A projector and a tablet send tiny requests. */
export async function readSmallJson(request: Request): Promise<Record<string, unknown> | null> {
  const length = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(length) && length > 4096) return null;
  try {
    const parsed = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}
