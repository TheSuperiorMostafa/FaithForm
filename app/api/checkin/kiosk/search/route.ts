import {
  KIOSK_COOKIE,
  checkinJson,
  clearCheckinCookie,
  readCheckinCookie,
  readSmallJson,
} from "@/lib/attendance/v2/checkin-http";
import {
  MIN_SEARCH_LENGTH,
  resolveKioskSession,
  searchKioskPeople,
} from "@/lib/attendance/v2/kiosk-session";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Finds people for a paired kiosk.
 *
 * POST rather than GET, deliberately: a name in a query string is a name in a
 * browser history, a proxy log, and a referrer header. A congregation member's
 * name is not URL material.
 *
 * The kiosk is resolved on **every** call, which is what enforces the idle lock:
 * a tablet left alone past its window stops resolving mid-session and asks for a
 * volunteer rather than staying open on a table.
 */
export async function POST(request: Request) {
  const credential = await readCheckinCookie(KIOSK_COOKIE);
  if (!credential) return checkinJson({ ok: false, error: "unpaired" }, 401);

  const resolved = await resolveKioskSession(credential);
  if (!resolved.ok) {
    if (resolved.reason === "locked") {
      // The credential is real and the tablet keeps it; a volunteer unlocks by
      // searching again after touching the screen. Distinct because it is
      // actionable, and it tells nobody anything they did not already hold.
      return checkinJson({ ok: false, error: "locked" }, 423);
    }
    if (resolved.reason === "unauthorized") await clearCheckinCookie(KIOSK_COOKIE);
    return checkinJson({ ok: false, error: "unpaired" }, 401);
  }

  // A kiosk searching hundreds of times a minute is not a welcome desk.
  const budget = await checkRateLimit(
    `checkin:kiosk:search:${resolved.session.kioskSessionId}`,
    { limit: 120, windowMs: 60 * 1000 },
  );
  if (!budget.ok) {
    return checkinJson(
      { ok: false, error: "throttled", retryAfterSeconds: budget.retryAfterSeconds },
      429,
    );
  }

  const body = await readSmallJson(request);
  const query = typeof body?.query === "string" ? body.query : "";

  if (query.trim().length < MIN_SEARCH_LENGTH) {
    // Not an error — the honest answer to "show me everyone" is nothing.
    return checkinJson({ ok: true, people: [], truncated: false, minLength: MIN_SEARCH_LENGTH });
  }

  const result = await searchKioskPeople({ session: resolved.session, query });
  return checkinJson({ ok: true, ...result, minLength: MIN_SEARCH_LENGTH });
}
