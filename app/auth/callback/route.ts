import { NextResponse } from "next/server";
import { callbackDiagnosticCode } from "@/lib/auth/callback-diagnostics";
import { sessionCameFromRecovery } from "@/lib/auth/recovery";
import { getChurchAuth } from "@/lib/auth/church";
import { isPlatformAdminUser } from "@/lib/auth/superadmin";
import { resolveSignedInLanding } from "@/lib/auth/signed-in-landing";
import { createClient } from "@/lib/supabase/server";
import { safeRedirectPath } from "@/lib/security/safe-redirect";

/**
 * The dashboard's post-auth callback, and only the dashboard's.
 *
 * The Faithful app finishes inside the app, on `faithful://auth/callback`; a
 * mobile code has no business here and cannot be completed here anyway,
 * because its PKCE verifier lives in the phone's keychain. What this route
 * must guarantee is that a person who arrives by a stale or misrouted link is
 * never left staring at a blank page.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Never an arbitrary destination: same-origin relative paths only, so a
  // crafted `next` cannot forward a fresh session off-site or into the app's
  // custom scheme.
  const next = safeRedirectPath(searchParams.get("next"));

  if (code) {
    const supabase = createClient();
    const { data, error } = await supabase.auth.exchangeCodeForSession(code);

    if (!error) {
      // A reset link must land on the reset screen even when the `next`
      // instruction was stripped — Supabase falls back to the bare Site URL
      // for any redirect not on its allow-list. The session's own `amr`
      // claim says how it was minted, so the token is the source of truth
      // rather than a query parameter that may not have survived.
      if (sessionCameFromRecovery(data.session?.access_token)) {
        return redirectTo(`${origin}/set-password?reason=recovery`);
      }

      // A session that cannot open the dashboard must not be sent to it.
      // This is the misroute case: a Faithful visitor whose confirmation link
      // was pointed at the Site URL lands here with a perfectly valid
      // identity and no staff membership. `/login` renders the explanation;
      // sending them to `/dashboard` produced the blank page.
      //
      // Only `/dashboard` destinations are re-checked — a recovery or setup
      // path is a legitimate signed-in page for an account with no church yet.
      if (next.startsWith("/dashboard")) {
        const user = data.session?.user ?? null;
        const hasChurchMembership = Boolean(await getChurchAuth());
        const landing = resolveSignedInLanding({
          hasChurchMembership,
          isPlatformAdmin:
            hasChurchMembership || !user ? false : await isPlatformAdminUser(user),
        });

        if (landing.kind === "no_dashboard_access") {
          return redirectTo(`${origin}/login`);
        }
        if (landing.kind === "admin") {
          return redirectTo(`${origin}/admin`);
        }
      }

      return redirectTo(`${origin}${next}`);
    }
  }

  // Exhausted: no code, a refused code, or a provider-reported failure. All of
  // them mean the same thing to the person holding the link — it did not work
  // and signing in does. The query string carries a single opaque marker; the
  // machine-readable reason goes to the server log and nowhere else, so no
  // provider wording, address, or code is ever shown or linked.
  console.warn(
    `[auth] callback rejected reason=${callbackDiagnosticCode(searchParams)}`,
  );
  return redirectTo(`${origin}/login?error=auth`);
}

/**
 * Redirects with caching switched off.
 *
 * The request that carried the code must not be cached by a proxy or the
 * browser's back/forward store — the redirect itself is fine, but a cached
 * one would replay a spent exchange and read as a broken link.
 */
function redirectTo(url: string): NextResponse {
  return NextResponse.redirect(url, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
