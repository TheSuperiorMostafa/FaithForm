"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export type SectionLinkTab = {
  label: string;
  href: string;
  /**
   * How to match the current path. Every caller is a Server Component layout,
   * so this type crosses the RSC boundary and must stay JSON-serializable —
   * a predicate function here throws "Functions cannot be passed directly to
   * Client Components" at render time and blanks the whole section.
   *
   * "exact" suits a section index whose children have their own tabs;
   * "prefix" (the default) keeps a tab active on nested routes.
   */
  match?: "exact" | "prefix";
  /** Other routes that should also light up this tab (prefix match). */
  also?: string[];
};

type SectionLinkTabsProps = {
  tabs: SectionLinkTab[];
  className?: string;
  /** What these links switch between, for screen readers. */
  label?: string;
};

function isUnder(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

function isTabActive(pathname: string, tab: SectionLinkTab) {
  if ((tab.also ?? []).some((href) => isUnder(pathname, href))) return true;
  if (tab.match === "exact") return pathname === tab.href;
  return isUnder(pathname, tab.href);
}

/**
 * Page-level links styled as a segmented control. They navigate, so they are
 * links in a <nav> with aria-current — not ARIA tabs, which promise a tab
 * panel on the same page. 44px targets, 15px labels.
 */
export function SectionLinkTabs({ tabs, className, label = "In this section" }: SectionLinkTabsProps) {
  const pathname = usePathname();

  return (
    <nav
      className={cn(
        "flex w-fit max-w-full gap-1 overflow-x-auto rounded-2xl border border-border bg-card p-1.5 shadow-sm",
        className,
      )}
      aria-label={label}
    >
      {tabs.map((tab) => {
        const active = isTabActive(pathname, tab);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "inline-flex min-h-11 shrink-0 items-center justify-center rounded-xl px-5 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-primary text-primary-foreground shadow-sm"
                : "text-foreground/75 hover:bg-muted hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </nav>
  );
}
