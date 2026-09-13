/**
 * Which paths the middleware holds behind a sign-in, as a decision with no
 * request, cookie or Supabase client in it.
 *
 * Everything is public unless it is named here. That default is deliberate and
 * is what the App Store and Google Play rely on without knowing it: the Privacy
 * Policy, the Terms and the account-deletion instructions are linked from store
 * listings and opened by people who have never signed in, and a sign-in wall in
 * front of them would read to a reviewer as a policy that does not exist. So
 * this is the list of what is *gated*, and the tests pin both directions.
 *
 * Runs in middleware on the edge runtime, so it stays string work only.
 */

export type RouteGate =
  /** Anyone, signed in or not. */
  | "public"
  /**
   * The church setup flow. Handled before any other gate because an invitee is
   * part-way through creating the account the other gates would ask for.
   */
  | "onboarding"
  /** A signed-in session; the dashboard itself then checks church membership. */
  | "signed_in"
  /** A signed-in platform administrator. */
  | "platform_admin";

export function routeGate(pathname: string): RouteGate {
  // `startsWith` without a trailing slash, matching what the middleware has
  // always done. Narrowing it to `/dashboard/` would quietly unguard
  // `/dashboard` itself.
  if (pathname.startsWith("/onboarding")) return "onboarding";
  if (pathname.startsWith("/dashboard")) return "signed_in";
  if (pathname.startsWith("/admin")) return "platform_admin";
  return "public";
}
