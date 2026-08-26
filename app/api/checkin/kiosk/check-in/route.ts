import { randomUUID } from "node:crypto";

import {
  KIOSK_COOKIE,
  checkinJson,
  clearCheckinCookie,
  readCheckinCookie,
  readSmallJson,
} from "@/lib/attendance/v2/checkin-http";
import { kioskCheckIn, resolveKioskSession } from "@/lib/attendance/v2/kiosk-session";
import { displayMessageFor } from "@/lib/attendance/v2/results";
import { checkRateLimit } from "@/lib/security/rate-limit";

export const dynamic = "force-dynamic";

/**
 * Checks one person in from the welcome desk.
 *
 * The request names a person and nothing else. The occurrence comes from the
 * kiosk session, the church comes from the occurrence, and the counted fact
 * comes from `record_attendance` — the same command a phone, the dashboard, and
 * a bulk roster all use. There is no kiosk-shaped insert anywhere.
 *
 * **An offline kiosk cannot claim anything.** If this request does not reach the
 * server there is no result, and the tablet's own code says so rather than
 * showing a tick and hoping. Faithful does not queue kiosk check-ins locally:
 * a queue would mean telling someone they were counted before anything had
 * decided that they were, and the honest failure is to say the desk is offline.
 */
export async function POST(request: Request) {
  const credential = await readCheckinCookie(KIOSK_COOKIE);
  if (!credential) return checkinJson({ ok: false, error: "unpaired" }, 401);

  const resolved = await resolveKioskSession(credential);
  if (!resolved.ok) {
    if (resolved.reason === "locked") return checkinJson({ ok: false, error: "locked" }, 423);
    if (resolved.reason === "unauthorized") await clearCheckinCookie(KIOSK_COOKIE);
    return checkinJson({ ok: false, error: "unpaired" }, 401);
  }

  const budget = await checkRateLimit(
    `checkin:kiosk:count:${resolved.session.kioskSessionId}`,
    { limit: 240, windowMs: 60 * 1000 },
  );
  if (!budget.ok) {
    return checkinJson(
      { ok: false, error: "throttled", retryAfterSeconds: budget.retryAfterSeconds },
      429,
    );
  }

  const body = await readSmallJson(request);
  const memberId = typeof body?.memberId === "string" ? body.memberId : "";
  if (!/^[0-9a-f-]{36}$/i.test(memberId)) {
    return checkinJson({ ok: false, error: "invalid" }, 400);
  }

  // The tablet supplies its own key so a retry after a dropped response finds
  // the first attempt rather than creating a second.
  const idempotencyKey =
    typeof body?.idempotencyKey === "string" && body.idempotencyKey.length <= 128
      ? body.idempotencyKey
      : randomUUID();

  const result = await kioskCheckIn({
    session: resolved.session,
    memberId,
    idempotencyKey,
  });

  return checkinJson({
    ok: result.outcome === "counted" || result.outcome === "already_counted",
    outcome: result.outcome,
    message: displayMessageFor(result.reason),
  });
}
