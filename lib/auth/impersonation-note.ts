/**
 * The parts of the impersonation note the edge middleware needs, as string
 * work only: the edge runtime has no `node:crypto` and no cookie jar, so the
 * signing and authorization in `impersonation.ts` cannot be imported there.
 */

export const IMPERSONATION_COOKIE = "faithform:acting-as";

/**
 * Whose note this claims to be, without checking the signature.
 *
 * Only ever used to *remove* a note that is not the signed-in person's, so an
 * unverified answer cannot grant anything: a forged note naming the current
 * user is kept here and still refused by the signature check that decides
 * data access.
 */
export function impersonationNoteOwner(value: string): string | null {
  const [payload] = value.split(".");
  if (!payload) return null;
  try {
    const padded = payload.replace(/-/g, "+").replace(/_/g, "/");
    const parsed = JSON.parse(atob(padded + "=".repeat((4 - (padded.length % 4)) % 4))) as {
      adminUserId?: unknown;
    };
    return typeof parsed.adminUserId === "string" ? parsed.adminUserId : null;
  } catch {
    return null;
  }
}
