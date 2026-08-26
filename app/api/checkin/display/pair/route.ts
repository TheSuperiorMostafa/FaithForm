import {
  DISPLAY_COOKIE,
  checkinJson,
  readSmallJson,
  setCheckinCookie,
  throttleTypedCode,
} from "@/lib/attendance/v2/checkin-http";
import { redeemDisplayPairing } from "@/lib/attendance/v2/checkin-session";

export const dynamic = "force-dynamic";

/**
 * Pairs a projector.
 *
 * The machine running the display has no account and never gets one. It types a
 * code a staff member read off their own screen and receives, in exchange, a
 * capability that can read one occurrence's current check-in code and nothing
 * else.
 *
 * Notice what is not in the response: no church name, no occurrence label, no
 * staff member, and no indication of *why* a code failed. A machine that has
 * paired successfully learns what it needs from the frame endpoint; a machine
 * guessing learns nothing at all.
 */
export async function POST(request: Request) {
  const throttle = await throttleTypedCode(request, "display-pair");
  if (!throttle.ok) {
    return checkinJson(
      { ok: false, error: "throttled", retryAfterSeconds: throttle.retryAfterSeconds },
      429,
    );
  }

  const body = await readSmallJson(request);
  const code = typeof body?.code === "string" ? body.code : "";

  const result = await redeemDisplayPairing(code);
  if (!result.ok) {
    // Unknown, expired, already used, and belonging to a stopped session are
    // one answer. A machine typing codes must not learn which it hit.
    return checkinJson({ ok: false, error: "invalid" }, 401);
  }

  const secondsRemaining = Math.max(
    60,
    Math.floor((new Date(result.session.expiresAt).getTime() - Date.now()) / 1000),
  );
  await setCheckinCookie(DISPLAY_COOKIE, result.capability, secondsRemaining);

  return checkinJson({
    ok: true,
    rotationSeconds: result.session.rotationSeconds,
    expiresAt: result.session.expiresAt,
  });
}
