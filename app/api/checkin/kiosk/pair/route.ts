import {
  KIOSK_COOKIE,
  checkinJson,
  readSmallJson,
  setCheckinCookie,
  throttleTypedCode,
} from "@/lib/attendance/v2/checkin-http";
import { pairKiosk } from "@/lib/attendance/v2/kiosk-session";

export const dynamic = "force-dynamic";

/**
 * Pairs a welcome-desk tablet.
 *
 * What the tablet ends up holding is a random credential bound to one
 * occurrence — not a staff account, not a role, and not anything that survives
 * the service. The response says which occurrence it is for so the screen can
 * label itself, and nothing else about the church.
 */
export async function POST(request: Request) {
  const throttle = await throttleTypedCode(request, "kiosk-pair");
  if (!throttle.ok) {
    return checkinJson(
      { ok: false, error: "throttled", retryAfterSeconds: throttle.retryAfterSeconds },
      429,
    );
  }

  const body = await readSmallJson(request);
  const code = typeof body?.code === "string" ? body.code : "";

  const result = await pairKiosk(code);
  if (!result.ok) return checkinJson({ ok: false, error: "invalid" }, 401);

  const secondsRemaining = Math.max(
    60,
    Math.floor((new Date(result.expiresAt).getTime() - Date.now()) / 1000),
  );
  // The cookie may live as long as the kiosk session, but the *idle lock* is
  // enforced server-side on every call — so a cookie outliving its usefulness
  // still resolves to nothing.
  await setCheckinCookie(KIOSK_COOKIE, result.credential, secondsRemaining);

  return checkinJson({
    ok: true,
    idleLockSeconds: result.session.idleLockSeconds,
    expiresAt: result.expiresAt,
  });
}
