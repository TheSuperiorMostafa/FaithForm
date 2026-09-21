import Link from "next/link";

import { Logo } from "@/components/brand/logo";
import { LEGAL_PATHS, SUPPORT_EMAIL } from "@/lib/legal/policy-versions";
import { cn } from "@/lib/utils";

/**
 * The frame every public legal page shares: who it is from, when it took
 * effect, the text, and a way to the other two documents and to a person.
 *
 * Plain on purpose. These pages are read by someone deciding whether to trust
 * an app with their location or their giving, and by store reviewers checking
 * a box; neither is helped by anything but readable type on the same tokens the
 * sign-in page uses, in either theme.
 *
 * The project has no typography plugin, so the document's own headings, lists
 * and links are styled here once rather than repeated on every element.
 */
export function LegalDocument({
  title,
  summary,
  effectiveDate,
  children,
}: {
  title: string;
  summary: string;
  /** Already formatted, e.g. from `formatPolicyDate`. Omitted for a how-to page. */
  effectiveDate?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-3xl items-center justify-between gap-4 px-5 py-4">
          <Link href="/login" className="flex items-center gap-2">
            <Logo size={32} priority />
            <span className="font-heading text-lg font-semibold">FaithForm</span>
          </Link>
          <a
            href={`mailto:${SUPPORT_EMAIL}`}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {SUPPORT_EMAIL}
          </a>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-5 py-10 md:py-14">
        <h1 className="font-heading text-3xl font-bold tracking-tight md:text-4xl">
          {title}
        </h1>
        {effectiveDate ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Effective {effectiveDate}
          </p>
        ) : null}
        <p className="mt-6 text-lg leading-relaxed text-muted-foreground">{summary}</p>

        <article
          className={cn(
            "mt-10 text-base leading-7",
            "[&_h2]:mt-12 [&_h2]:scroll-mt-6 [&_h2]:font-heading [&_h2]:text-xl [&_h2]:font-bold [&_h2]:tracking-tight",
            "[&_h3]:mt-8 [&_h3]:font-heading [&_h3]:text-base [&_h3]:font-semibold",
            "[&_p]:mt-4",
            "[&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6",
            "[&_ol]:mt-4 [&_ol]:list-decimal [&_ol]:space-y-2 [&_ol]:pl-6",
            "[&_li]:pl-1",
            "[&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4",
            "[&_strong]:font-semibold",
          )}
        >
          {children}
        </article>
      </main>

      <footer className="border-t border-border">
        <nav
          aria-label="Legal"
          className="mx-auto flex max-w-3xl flex-wrap items-center gap-x-6 gap-y-2 px-5 py-6 text-sm text-muted-foreground"
        >
          <Link href={LEGAL_PATHS.privacy} className="hover:text-foreground">
            Privacy Policy
          </Link>
          <Link href={LEGAL_PATHS.terms} className="hover:text-foreground">
            Terms of Service
          </Link>
          <Link href={LEGAL_PATHS.accountDeletion} className="hover:text-foreground">
            Delete your account
          </Link>
          <Link href={LEGAL_PATHS.support} className="hover:text-foreground">
            Support
          </Link>
          <a href={`mailto:${SUPPORT_EMAIL}`} className="hover:text-foreground">
            Contact
          </a>
        </nav>
      </footer>
    </div>
  );
}
