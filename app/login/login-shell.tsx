import Link from "next/link";
import { LEGAL_PATHS } from "@/lib/legal/policy-versions";

/**
 * The page around the sign-in card, shared with `loading.tsx` so the card,
 * the "new church" link and the legal links sit in the same place whether the
 * form has loaded or not.
 */
export function LoginShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[radial-gradient(circle_at_top,var(--secondary),var(--background)_55%)] px-4 py-10 sm:p-8">
      <div className="w-full max-w-md">
        {children}
        <NewChurchLink />
        <LegalLinks />
      </div>
    </main>
  );
}

/** First-time pastors land here too; the way to start is right under the card. */
function NewChurchLink() {
  return (
    <p className="mt-6 flex flex-wrap items-center justify-center gap-x-2 text-center text-base text-muted-foreground">
      New to FaithForm?
      <Link
        href="/setup"
        className="inline-flex min-h-11 items-center font-semibold text-primary underline underline-offset-4 hover:text-accent dark:text-accent"
      >
        Set up your church
      </Link>
    </p>
  );
}

/**
 * Under the card rather than inside it: the card changes shape between sign-in,
 * magic link and reset, and these links should not move or disappear with it.
 * The sign-in page is also the first page anyone arriving at faithform.io sees,
 * so it is where a store reviewer looks for the policies.
 */
function LegalLinks() {
  return (
    <nav
      aria-label="Legal"
      className="mt-2 flex items-center justify-center gap-4 text-sm text-muted-foreground"
    >
      <Link href={LEGAL_PATHS.privacy} className="inline-flex min-h-11 items-center hover:text-foreground hover:underline underline-offset-4">
        Privacy
      </Link>
      <span aria-hidden>·</span>
      <Link href={LEGAL_PATHS.terms} className="inline-flex min-h-11 items-center hover:text-foreground hover:underline underline-offset-4">
        Terms
      </Link>
    </nav>
  );
}
