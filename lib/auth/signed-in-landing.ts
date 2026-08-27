/**
 * Where an authenticated person belongs when they arrive at the sign-in page.
 *
 * This decision used to be implicit — the login page sent every authenticated
 * user to /dashboard, and the dashboard layout sent everyone without a church
 * membership back to /login. For a Faithful visitor account (real Supabase
 * identity, no `church_users` row) those two rules chased each other into a
 * redirect loop the browser rendered as a blank page. Making the decision a
 * total function ends that: every case has exactly one destination, and
 * "no access" is a page, never another redirect.
 */
export type SignedInLanding =
  | { kind: "dashboard" }
  | { kind: "admin" }
  | { kind: "no_dashboard_access" };

export function resolveSignedInLanding(input: {
  hasChurchMembership: boolean;
  isPlatformAdmin: boolean;
}): SignedInLanding {
  if (input.hasChurchMembership) return { kind: "dashboard" };
  if (input.isPlatformAdmin) return { kind: "admin" };
  // A visitor (Faithful) account, or a stale staff account whose membership
  // was removed. Rendered in place — redirecting anywhere signed-in-gated
  // would restart the loop, and granting access is not this function's call.
  return { kind: "no_dashboard_access" };
}
