import { mintCapability, verifyCapability } from "@/lib/attendance/v2/signing";

/**
 * What lets a kids checkout be recorded as "code checked".
 *
 * The release used to take the method from the browser: a volunteer's console
 * — or anyone with Check-In calling the action directly — could say `code` or
 * `qr` for any open session, release any child with no code and no written
 * reason, and the audit would say a code had been verified. Now the lookup
 * that actually checked a code or QR hands back this short-lived ticket, and
 * only a release carrying it may say so. Anything else is an override, which
 * needs its written reason.
 */

export type ReleaseTicket = {
  churchId: string;
  householdId: string;
  method: "qr" | "code";
  staffUserId: string;
};

/** Long enough for a family to gather coats; short enough to be this visit. */
const TICKET_TTL_SECONDS = 20 * 60;

export function mintReleaseTicket(ticket: ReleaseTicket): string | null {
  return mintCapability("checkout.release", {
    v: 1,
    c: ticket.churchId,
    h: ticket.householdId,
    m: ticket.method,
    u: ticket.staffUserId,
    e: Math.floor(Date.now() / 1000) + TICKET_TTL_SECONDS,
  });
}

/** The ticket's family, when it was minted for this church, staff member and method and is in date. */
export function verifyReleaseTicket(
  token: string | null | undefined,
  expected: { churchId: string; staffUserId: string; method: "qr" | "code" },
): { householdId: string } | null {
  const verified = verifyCapability<{ c?: unknown; h?: unknown; m?: unknown; u?: unknown; e?: unknown }>(
    "checkout.release",
    token,
  );
  if (!verified.ok) return null;
  const { c, h, m, u, e } = verified.body;
  if (typeof e !== "number" || e * 1000 <= Date.now()) return null;
  if (c !== expected.churchId || u !== expected.staffUserId || m !== expected.method) return null;
  return typeof h === "string" ? { householdId: h } : null;
}
