import type { Metadata } from "next";

import { ConfirmFromFragment } from "./confirm-from-fragment";

export const metadata: Metadata = {
  title: "Signing you in | FaithForm",
  // A page that exists to consume a one-time link has nothing to index, and a
  // crawler following a stray link here would only ever see the spinner.
  robots: { index: false, follow: false },
};

/**
 * Where `/auth/callback` sends an arrival it cannot read on the server: a
 * password-reset link from the phone apps, whose session is in the URL
 * fragment. The work is all in the client component; this shell exists for the
 * metadata and so the page renders something while that runs.
 */
export default function AuthConfirmPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,var(--secondary),var(--background)_55%)] p-5">
      <div className="w-full max-w-md">
        <ConfirmFromFragment />
      </div>
    </main>
  );
}
