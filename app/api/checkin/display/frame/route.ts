import QRCode from "qrcode";

import {
  DISPLAY_COOKIE,
  checkinJson,
  clearCheckinCookie,
  readCheckinCookie,
} from "@/lib/attendance/v2/checkin-http";
import {
  currentDisplayFrame,
  verifyDisplayCapability,
} from "@/lib/attendance/v2/checkin-session";

export const dynamic = "force-dynamic";

/**
 * The current frame for a paired display.
 *
 * Polled once per rotation. Three things make a refresh recover rather than
 * break the display:
 *
 *   * the capability is in a cookie, so reloading the page keeps it;
 *   * the code is a **derived** function of the session and the rotation
 *     window, so a reload lands on exactly the code the room was already
 *     looking at rather than rotating it early; and
 *   * the frame carries `rotatesAt`, so a client that slept through a rotation
 *     knows to poll immediately rather than showing a stale code.
 *
 * The PNG is embedded rather than served from a second URL. A code in a URL is a
 * code in a browser history, a proxy log, and a referrer header — and this one
 * would be a live capability.
 *
 * **The session is re-checked on every poll.** A display the pastor stopped goes
 * dark within one rotation without anyone touching the machine.
 */
export async function GET() {
  const capability = await readCheckinCookie(DISPLAY_COOKIE);
  if (!capability) return checkinJson({ ok: false, error: "unpaired" }, 401);

  const verified = await verifyDisplayCapability(capability);
  if (!verified.ok) {
    // The session ended, the capability expired, or the signing key rotated
    // past it. In every case this machine needs pairing again, so the stale
    // cookie is removed rather than left to fail on every poll.
    if (verified.reason !== "unavailable") await clearCheckinCookie(DISPLAY_COOKIE);
    return checkinJson({ ok: false, error: "unpaired" }, 401);
  }

  const frame = await currentDisplayFrame(verified.session);
  if (!frame) return checkinJson({ ok: false, error: "unavailable" }, 503);

  const png = await QRCode.toDataURL(frame.qrToken, {
    // Medium recovery. High would survive more of a hand across the projector
    // but costs modules, and modules are what decide whether the back row can
    // scan it at all.
    errorCorrectionLevel: "M",
    margin: 2,
    width: 720,
  });

  return checkinJson({
    ok: true,
    qrImage: png,
    shortCode: frame.shortCodeDisplay,
    rotatesAt: frame.rotatesAt,
    expiresAt: frame.expiresAt,
    rotationSeconds: frame.rotationSeconds,
    sessionExpiresAt: verified.session.expiresAt,
  });
}
