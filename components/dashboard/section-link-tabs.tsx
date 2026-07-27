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
};

type SectionLinkTabsProps = {
  tabs: SectionLinkTab[];
  className?: string;
};

function isTabActive(
  pathname: string,
  href: string,
  match: SectionLinkTab["match"] = "prefix",
) {
  if (match === "exact") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SectionLinkTabs({ tabs, className }: SectionLinkTabsProps) {
  const pathname = usePathname();

  return (
    <div
      className={cn(
        "flex gap-1 overflow-x-auto rounded-xl border border-border bg-muted/40 p-1",
        className,
      )}
      role="tablist"
      aria-label="Section"
    >
      {tabs.map((tab) => {
        const active = isTabActive(pathname, tab.href, tab.match);

        return (
          <Link
            key={tab.href}
            href={tab.href}
            role="tab"
            aria-selected={active}
            className={cn(
              "inline-flex min-h-9 shrink-0 items-center justify-center rounded-lg px-4 text-sm font-semibold transition-colors",
              active
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
