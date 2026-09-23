import type { Metadata } from "next";

import { AppConfirmHandoff } from "./handoff";

/**
 * Where a FaithForm confirmation email lands.
 *
 * The apps register this page, not `faithform://auth/callback`, as the
 * confirmation redirect. Supabase confirms the address and then redirects
 * here; the hand-off to the app happens from this page, which is a navigation
 * a browser will perform, unlike the `302` into a custom scheme that preceded
 * it and left every new member staring at a connection error.
 *
 * Nothing is exchanged here and nothing is stored: the code passes through to
 * the app, which alone holds the verifier that can spend it. The page is
 * unindexed and sends no referrer, so the code it briefly holds does not
 * travel anywhere with it.
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Confirming your email | FaithForm",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default function AppConfirmCallbackPage() {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4 py-12 text-foreground">
      <div className="w-full max-w-md rounded-2xl border border-border bg-card p-6 shadow-sm">
        <AppConfirmHandoff />
      </div>
    </main>
  );
}
