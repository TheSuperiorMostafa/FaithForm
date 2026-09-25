"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type MouseEvent } from "react";
import { LogOut, Menu, X } from "lucide-react";
import type { FeatureKey } from "@/lib/features/catalog";
import { cn } from "@/lib/utils";
import {
  NAV_GROUP_LABELS,
  filterNavByFeatures,
  footerUtilityNavItems,
  isNavItemActive,
  navItems,
  type NavItem,
} from "./nav-items";

/**
 * Phones get four sections plus More. More lists every section, Help,
 * Settings and Sign out, so nothing in the dashboard is desktop-only.
 */
const MAX_TABS = 4;

/** Home, then the church's most time-sensitive tools. */
const MOBILE_PRIORITY = [
  "/dashboard",
  "/dashboard/checkin",
  "/dashboard/people",
  "/dashboard/live-streaming",
  "/dashboard/attendance",
  "/dashboard/announcements",
  "/dashboard/groups",
];

function isModified(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

export function BottomNav({ allowedFeatures }: { allowedFeatures: FeatureKey[] }) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setPendingHref(null);
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    sheetRef.current?.querySelector<HTMLElement>("a,button")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [moreOpen]);

  const all = filterNavByFeatures(navItems, allowedFeatures);
  const rank = (item: NavItem) => {
    const i = MOBILE_PRIORITY.indexOf(item.href);
    return i === -1 ? MOBILE_PRIORITY.length : i;
  };
  const tabs = [...all].sort((a, b) => rank(a) - rank(b)).slice(0, MAX_TABS);
  const moreActive =
    !tabs.some((item) => isNavItemActive(pathname, item)) &&
    [...all, ...footerUtilityNavItems].some((item) => isNavItemActive(pathname, item));

  const tabClass = (selected: boolean) =>
    cn(
      "relative flex min-h-[4rem] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-center transition-colors",
      selected ? "text-sidebar-accent" : "text-white/80 active:text-white",
    );

  return (
    <>
      {moreOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="All sections">
          <button
            type="button"
            aria-label="Close"
            className="absolute inset-0 bg-brand-navy/50"
            onClick={() => setMoreOpen(false)}
          />
          <div
            ref={sheetRef}
            className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl bg-card px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4 text-card-foreground shadow-2xl"
          >
            <div className="mb-2 flex items-center justify-between px-2">
              <p className="font-heading text-xl font-bold">All sections</p>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                className="flex size-11 items-center justify-center rounded-xl text-muted-foreground hover:bg-muted"
                aria-label="Close"
              >
                <X className="size-5" aria-hidden />
              </button>
            </div>
            {(["home", "weekly", "online"] as const).map((group) => {
              const items = all.filter((item) => item.group === group);
              if (!items.length) return null;
              return (
                <div key={group} className="mt-3">
                  {group !== "home" && (
                    <p className="px-2 pb-1 text-xs font-bold uppercase tracking-[0.14em] text-muted-foreground">
                      {NAV_GROUP_LABELS[group]}
                    </p>
                  )}
                  <SheetList items={items} pathname={pathname} />
                </div>
              );
            })}
            <div className="mt-3 border-t border-border pt-3">
              <SheetList items={footerUtilityNavItems} pathname={pathname} />
              <form action="/auth/signout" method="post">
                <button
                  type="submit"
                  className="flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-base font-semibold text-foreground hover:bg-muted"
                >
                  <LogOut className="size-5 text-muted-foreground" aria-hidden />
                  Sign out
                </button>
              </form>
            </div>
          </div>
        </div>
      )}

      <nav
        aria-label="Sections"
        className="fixed bottom-0 left-0 right-0 z-40 border-t border-border bg-sidebar text-sidebar shadow-2xl md:hidden"
      >
        <div className="flex items-stretch justify-around px-1 pb-[env(safe-area-inset-bottom)]">
          {tabs.map((item) => {
            const active = isNavItemActive(pathname, item);
            const pending = pendingHref === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                aria-busy={pending || undefined}
                onClick={(event) => {
                  if (isModified(event) || active) return;
                  setPendingHref(item.href);
                }}
                className={tabClass(active || pending)}
              >
                {(active || pending) && (
                  <span
                    className="absolute left-1/2 top-0 h-[3px] w-8 -translate-x-1/2 rounded-b-full bg-sidebar-accent"
                    aria-hidden
                  />
                )}
                <Icon className="size-6 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className="truncate text-xs font-semibold leading-none">
                  {item.shortLabel ?? item.label}
                </span>
              </Link>
            );
          })}
          <button
            type="button"
            aria-haspopup="dialog"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(true)}
            className={tabClass(moreActive)}
          >
            {moreActive && (
              <span
                className="absolute left-1/2 top-0 h-[3px] w-8 -translate-x-1/2 rounded-b-full bg-sidebar-accent"
                aria-hidden
              />
            )}
            <Menu className="size-6 shrink-0" strokeWidth={1.75} aria-hidden />
            <span className="truncate text-xs font-semibold leading-none">More</span>
          </button>
        </div>
      </nav>
    </>
  );
}

function SheetList({ items, pathname }: { items: NavItem[]; pathname: string }) {
  return (
    <ul className="space-y-1">
      {items.map((item) => {
        const active = isNavItemActive(pathname, item);
        const Icon = item.icon;
        return (
          <li key={item.href}>
            <Link
              href={item.href}
              aria-current={active ? "page" : undefined}
              className={cn(
                "flex min-h-12 items-center gap-3 rounded-xl px-3 text-base font-semibold",
                active ? "bg-accent/15 text-primary dark:text-accent" : "text-foreground hover:bg-muted",
              )}
            >
              <Icon className="size-5 text-muted-foreground" strokeWidth={1.75} aria-hidden />
              {item.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
