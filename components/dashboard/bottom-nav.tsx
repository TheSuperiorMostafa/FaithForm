"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { navItems } from "./nav-items";

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function BottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 border-t border-border bg-sidebar text-sidebar shadow-2xl md:hidden">
      <div className="flex items-stretch justify-around px-1 pb-[env(safe-area-inset-bottom)]">
        {navItems.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "relative flex min-h-[4rem] min-w-0 flex-1 flex-col items-center justify-center gap-1 px-1 py-2 text-center transition-colors",
                active
                  ? "text-sidebar-accent"
                  : "text-white/70 active:text-white",
              )}
            >
              {active && (
                <span
                  className="absolute left-1/2 top-0 h-[3px] w-8 -translate-x-1/2 rounded-b-full bg-sidebar-accent"
                  aria-hidden
                />
              )}
              <Icon className="size-5 shrink-0" strokeWidth={1.75} aria-hidden />
              <span className="truncate text-[11px] font-semibold leading-none">
                {item.shortLabel ?? item.label}
              </span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
