/**
 * Whether a church admin may hand one of their teammates a new password.
 *
 * Inviting an email that already had a FaithForm login links that login to the
 * church without its owner saying yes, and anyone can become a church admin by
 * setting up a church. So "is on my team" cannot be what lets an admin replace
 * a password: that was a takeover of any app user's account — or a platform
 * administrator's — for the price of a new church.
 *
 * A church may reset only a login it made itself, through its own invite:
 *   - never a platform administrator,
 *   - never a login that also has a FaithForm app account (it is a person's
 *     own, whatever church they later helped),
 *   - and only when the login was created for this church — recorded in
 *     `app_metadata` from now on, which its owner cannot edit, or, for logins
 *     made before that record existed, created in the same moment the team
 *     link was made. A login that existed long before the link was someone's
 *     own account that the church linked, not one it created.
 *
 * Anyone else uses "Forgot password" on the sign-in page, which proves they
 * own the email address.
 */

/** `app_metadata` key naming the church whose invite created this login. */
export const PROVISIONED_BY_CHURCH_KEY = "provisioned_by_church_id";

/** How far apart a login's creation and its team link can be and still be one invite. */
const SAME_INVITE_WINDOW_MS = 10 * 60 * 1000;

/**
 * Logins made after this carry the `app_metadata` record when a church's
 * invite made them, so the timing rule is only for the ones before it. Without
 * the cutoff it would also cover logins people make for themselves from now on
 * — a church founder who signs up and finishes setup within ten minutes.
 */
const TIMING_RULE_ENDS = Date.parse("2026-10-01T00:00:00Z");

export type PasswordResetTarget = {
  churchId: string;
  isPlatformAdmin: boolean;
  hasAppAccount: boolean;
  appMetadata: Record<string, unknown> | null | undefined;
  /** `auth.users.created_at`. */
  accountCreatedAt: string | null | undefined;
  /** `church_users.created_at` for this church's link. */
  linkedAt: string | null | undefined;
};

export function churchMayResetPassword(target: PasswordResetTarget): boolean {
  if (target.isPlatformAdmin || target.hasAppAccount) return false;

  const provisionedBy = target.appMetadata?.[PROVISIONED_BY_CHURCH_KEY];
  if (typeof provisionedBy === "string") return provisionedBy === target.churchId;

  const created = Date.parse(target.accountCreatedAt ?? "");
  const linked = Date.parse(target.linkedAt ?? "");
  if (!Number.isFinite(created) || !Number.isFinite(linked)) return false;
  if (created >= TIMING_RULE_ENDS) return false;
  return created <= linked + 60_000 && linked - created <= SAME_INVITE_WINDOW_MS;
}
