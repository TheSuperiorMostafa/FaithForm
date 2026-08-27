"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";
import type { FeatureKey } from "@/lib/features/catalog";
import { cn } from "@/lib/utils";
import { filterNavByFeatures, navItems } from "./nav-items";

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav({
  allowedFeatures,
}: {
  allowedFeatures: FeatureKey[];
}) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);
  const items = filterNavByFeatures(navItems, allowedFeatures).filter(
    (item) => !item.sidebarOnly,
  );

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-sidebar text-sidebar shadow-2xl md:hidden">
      <div className="flex items-stretch justify-around px-1 pb-[env(safe-area-inset-bottom)]">
        {items.map((item) => {
          const active = isActive(pathname, item.href);
          const pending = pendingHref === item.href;
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              aria-current={active ? "page" : undefined}
              aria-busy={pending || undefined}
              onClick={(event: MouseEvent<HTMLAnchorElement>) => {
                if (
                  event.defaultPrevented ||
                  event.button !== 0 ||
                  event.metaKey ||
                  event.ctrlKey ||
                  event.shiftKey ||
                  event.altKey ||
                  active
                ) {
                  return;
                }
                setPendingHref(item.href);
              }}
              className={cn(
                "relative flex min-h-[4rem] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-center transition-colors",
                active || pending
                  ? "text-sidebar-accent"
                  : "text-white/70 active:text-white",
              )}
            >
              {(active || pending) && (
                <span
                  className="absolute left-1/2 top-0 h-[3px] w-8 -translate-x-1/2 rounded-b-full bg-sidebar-accent"
                  aria-hidden
                />
              )}
              <Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="truncate text-[11px] font-semibold leading-none">
                {item.shortLabel ?? item.label}
              </span>
              {pending && (
                <span
                  className="absolute right-2 top-2 size-1.5 animate-pulse rounded-full bg-sidebar-accent"
                  aria-hidden
                />
              )}
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
