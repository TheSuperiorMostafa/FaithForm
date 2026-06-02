"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, ShieldCheck } from "lucide-react";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { adminNavItems } from "./nav-items";

type AdminMobileNavProps = {
  userEmail: string;
};

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminMobileNav({ userEmail }: AdminMobileNavProps) {
  const pathname = usePathname();

  return (
    <>
      <header className="sticky top-0 z-30 flex items-center justify-between border-b border-border bg-card/90 px-5 py-3 shadow-sm backdrop-blur md:hidden">
        <div className="min-w-0">
          <p className="font-heading text-base font-bold text-foreground">FaithForm Admin</p>
          <p className="flex items-center gap-1 truncate text-xs text-muted-foreground">
            <ShieldCheck className="size-3 text-accent" strokeWidth={1.75} />
            {userEmail}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <ThemeToggle variant="compact" />
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              aria-label="Sign out"
              className="flex size-10 items-center justify-center rounded-xl text-muted-foreground transition-colors hover:bg-accent/10 hover:text-accent"
            >
              <LogOut className="size-4" strokeWidth={1.75} />
            </button>
          </form>
        </div>
      </header>

      <nav className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t border-sidebar bg-sidebar px-2 py-2 text-sidebar shadow-2xl md:hidden">
        {adminNavItems.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 rounded-xl px-1 py-2 text-[11px] font-semibold transition-colors",
                active
                  ? "bg-sidebar-accent/15 text-sidebar-accent"
                  : "text-white/70 hover:bg-brand-lightGold/15 hover:text-white",
              )}
            >
              <Icon className="size-5" strokeWidth={1.75} />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
