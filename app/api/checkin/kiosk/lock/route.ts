import { KIOSK_COOKIE, checkinJson, clearCheckinCookie } from "@/lib/attendance/v2/checkin-http";

export const dynamic = "force-dynamic";

/**
 * Forgets the credential on this device.
 *
 * The obvious use is a volunteer packing up. The less obvious one is the reason
 * the button exists at all: a tablet that walks away should be able to be made
 * useless from the tablet, immediately, by anyone standing at it — without
 * needing a staff login, a dashboard, or a network round trip to succeed.
 *
 * Ending the kiosk session from the dashboard is the stronger control and is
 * what actually revokes the credential server-side. This is the local half.
 */
export async function POST() {
  await clearCheckinCookie(KIOSK_COOKIE);
  return checkinJson({ ok: true });
}
