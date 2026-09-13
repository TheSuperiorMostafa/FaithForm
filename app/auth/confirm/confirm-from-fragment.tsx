"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

import { Logo } from "@/components/brand/logo";
import { readRecoveryFragment } from "@/lib/auth/recovery-fragment";
import { createClient } from "@/lib/supabase/client";

const RECOVERY_DESTINATION = "/set-password?reason=recovery";
const FAILURE_DESTINATION = "/login?error=auth";

/**
 * Turns a reset link's fragment into a signed-in session, then gets out of the
 * way.
 *
 * The order is the point:
 *
 *   1. Read the fragment once.
 *   2. Strip it from the address bar *before* anything else runs. The tokens
 *      are a live session; left in the URL they survive into history, a
 *      screenshot of the address bar, and a copied link.
 *   3. Only then build the browser Supabase client. Its own URL detection
 *      would otherwise see an implicit-flow fragment, refuse it as "not a
 *      valid PKCE flow url" (the browser client is PKCE), and log noise for a
 *      link that is about to work.
 *   4. `setSession` verifies the tokens with Supabase and writes the session
 *      cookies, which is what `/set-password` reads on the server.
 *
 * Anything that is not a recovery session lands where the callback has always
 * sent a link that did not work, so a person sees one failure message
 * regardless of which flow their link came from.
 */
export function ConfirmFromFragment() {
  const router = useRouter();
  // React runs effects twice in development. Spending the fragment twice would
  // find it already stripped on the second pass and bounce a working link to
  // the failure page. And there is deliberately no cleanup that cancels the
  // first pass: under that double run the first pass is the only one that has
  // the tokens, so cancelling it would strand the page on the spinner.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;

    const fragment = readRecoveryFragment(window.location.hash);

    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${window.location.search}`,
    );

    if (fragment.kind !== "recovery") {
      router.replace(FAILURE_DESTINATION);
      return;
    }

    const supabase = createClient();

    supabase.auth
      .setSession({
        access_token: fragment.accessToken,
        refresh_token: fragment.refreshToken,
      })
      .then(({ data, error }) => {
        if (error || !data.session) {
          router.replace(FAILURE_DESTINATION);
          return;
        }
        router.replace(RECOVERY_DESTINATION);
        // The server components behind the destination read the cookies
        // setSession just wrote; a cached render from before them would not.
        router.refresh();
      })
      .catch(() => {
        router.replace(FAILURE_DESTINATION);
      });
  }, [router]);

  return (
    <div
      className="rounded-2xl border border-border bg-card p-8 text-center shadow-card"
      role="status"
      aria-live="polite"
    >
      <Logo size={56} className="mx-auto mb-4" />
      <h1 className="font-heading text-[22px] font-bold text-foreground">
        Opening your reset link…
      </h1>
      <p className="mt-3 text-base text-muted-foreground">
        This only takes a moment.
      </p>
    </div>
  );
}
