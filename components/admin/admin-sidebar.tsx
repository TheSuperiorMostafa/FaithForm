"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LogOut, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme-toggle";
import { cn } from "@/lib/utils";
import { adminNavItems } from "./nav-items";

type AdminSidebarProps = {
  userEmail: string;
};

function isActive(pathname: string, href: string) {
  if (href === "/admin") return pathname === "/admin";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function AdminSidebar({ userEmail }: AdminSidebarProps) {
  const pathname = usePathname();
  const initial = (userEmail || "A").charAt(0).toUpperCase();

  return (
    <aside className="hidden h-dvh w-64 shrink-0 flex-col overflow-hidden border-r border-sidebar bg-sidebar text-sidebar shadow-2xl md:flex">
      <div className="flex shrink-0 items-center gap-3 border-b border-sidebar px-4 py-5">
        <Logo size={40} priority className="shadow-lg shadow-black/20" />
        <div className="min-w-0 flex-1">
          <p className="truncate font-heading text-lg font-bold leading-tight text-sidebar-accent">
            FaithForm
          </p>
          <p className="truncate text-xs font-semibold uppercase tracking-wide text-white/65">
            Platform Admin
          </p>
        </div>
      </div>

      <nav className="min-h-0 flex-1 space-y-1.5 overflow-y-auto overscroll-contain p-3">
        <p className="px-4 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.22em] text-sidebar-accent">
          Platform
        </p>
        {adminNavItems.map((item) => {
          const active = isActive(pathname, item.href);
          const Icon = item.icon;

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex items-center gap-3 rounded-lg px-4 py-3 text-sm font-semibold transition-all",
                active
                  ? "bg-sidebar-accent/15 text-sidebar-accent"
                  : "text-white/82 hover:bg-brand-lightGold/15 hover:text-white",
              )}
            >
              <span
                className={cn(
                  "absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-accent transition-opacity",
                  active ? "opacity-100" : "opacity-0",
                )}
                aria-hidden
              />
              <Icon
                className={cn(
                  "size-[22px] shrink-0 transition-colors",
                  active && "text-sidebar-accent",
                )}
                strokeWidth={1.75}
                aria-hidden
              />
              <span className="truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="shrink-0 border-t border-sidebar p-3">
        <ThemeToggle variant="segmented" className="mb-3 border-sidebar bg-white/5 text-white" />
        <div className="flex items-center gap-3 rounded-xl border border-sidebar bg-white/5 p-2">
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-sm font-bold text-white"
            aria-hidden
          >
            {initial}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-white">
              {userEmail}
            </p>
            <p className="flex items-center gap-1 truncate text-xs text-white/60">
              <ShieldCheck className="size-3" strokeWidth={1.75} />
              Super admin
            </p>
          </div>
          <form action="/auth/signout" method="post">
            <button
              type="submit"
              aria-label="Sign out"
              className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white/70 transition-colors hover:bg-brand-lightGold/15 hover:text-white"
            >
              <LogOut className="size-4" strokeWidth={1.75} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
