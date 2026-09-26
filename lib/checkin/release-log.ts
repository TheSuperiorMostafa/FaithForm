/**
 * The Reports page's log of children released without a pickup code.
 *
 * Every such release is already recorded on its session row: who released the
 * child (`checked_out_by`), when (`checked_out_at`), and the written reason
 * the checkout refuses to go without. These helpers only turn that record into
 * words a director can read.
 */

/** One child handed over without the family's code. */
export type NoCodeRelease = {
  sessionId: string;
  childName: string;
  roomName: string | null;
  /** The adult the child went home with, when the volunteer named one. */
  releasedToName: string | null;
  releasedAt: string;
  releasedByUserId: string | null;
  /** The team member's name, else their email, else a plain fallback. */
  releasedByLabel: string;
  reason: string | null;
};

/** What we know about the team member who pressed Release. */
export type StaffIdentity = {
  displayName?: string | null;
  email?: string | null;
};

export const UNKNOWN_STAFF_LABEL = "A team member no longer on your team";

/** Name first, then email, never a raw account id. */
export function staffLabel(identity: StaffIdentity | null | undefined): string {
  const name = identity?.displayName?.trim();
  if (name) return name;
  const email = identity?.email?.trim();
  if (email) return email;
  return UNKNOWN_STAFF_LABEL;
}

/** "Sun, Sep 21 at 10:42 AM", on the church's clock rather than the server's. */
export function formatReleaseTime(iso: string, timeZone: string): string {
  const at = new Date(iso);
  if (Number.isNaN(at.getTime())) return "";
  const zone = timeZone || "UTC";
  try {
    const day = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      weekday: "short",
      month: "short",
      day: "numeric",
      year:
        new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric" }).format(at) ===
        new Intl.DateTimeFormat("en-US", { timeZone: zone, year: "numeric" }).format(new Date())
          ? undefined
          : "numeric",
    }).format(at);
    const time = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hour: "numeric",
      minute: "2-digit",
    }).format(at);
    return `${day} at ${time}`;
  } catch {
    // An unrecognised zone name must not take the Reports page down.
    return zone === "UTC" ? at.toISOString() : formatReleaseTime(iso, "UTC");
  }
}

/** The heading's count line: "3 children in the last 8 weeks". */
export function noCodeReleaseSummary(total: number, weeks: number): string {
  if (total === 0) return `None in the last ${weeks} weeks.`;
  const children = total === 1 ? "1 child" : `${total} children`;
  return `${children} released without a pickup code in the last ${weeks} weeks.`;
}
