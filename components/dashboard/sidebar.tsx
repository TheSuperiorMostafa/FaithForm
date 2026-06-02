"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { ChevronLeft, ChevronRight, LogOut, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/superadmin-emails";
import { cn } from "@/lib/utils";
import { navItems } from "./nav-items";

type SidebarProps = {
  userEmail: string;
  churchName: string | null;
  role: string | null;
  initialCollapsed?: boolean;
};

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function setCollapsedCookie(value: boolean) {
  if (typeof document === "undefined") return;
  document.cookie = `sidebar:collapsed=${value ? "1" : "0"}; path=/; max-age=${
    60 * 60 * 24 * 365
  }; samesite=lax`;
}

export function Sidebar({
  userEmail,
  churchName,
  role,
  initialCollapsed = false,
}: SidebarProps) {
  const pathname = usePathname();
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const showAdminLink = isBootstrapSuperAdminEmail(userEmail);

  const initial = (userEmail ?? "F").charAt(0).toUpperCase();
  const resourceNavHrefs = new Set([
    "/dashboard/library",
    "/dashboard/support",
  ]);
  const navItemsForSidebar = navItems.filter(
    (item) => !resourceNavHrefs.has(item.href),
  );

  const toggle = () => {
    setCollapsed((prev) => {
      const next = !prev;
      setCollapsedCookie(next);
      return next;
    });
  };

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "group/sidebar relative hidden h-dvh shrink-0 flex-col overflow-hidden border-r border-sidebar bg-sidebar text-sidebar shadow-2xl",
        "transition-[width] duration-200 ease-out md:flex",
        collapsed ? "w-[72px]" : "w-64",
      )}
    >
      {/* Brand header */}
      <div
        className={cn(
          "flex shrink-0 items-center gap-3 border-b border-sidebar px-4 py-5 transition-all",
          collapsed && "justify-center px-2",
        )}
      >
        <Logo size={40} priority className="shadow-lg shadow-black/20" />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="truncate font-heading text-lg font-bold leading-tight text-sidebar-accent">
              FaithForm
            </p>
            {churchName && (
              <p className="truncate text-xs font-semibold uppercase tracking-wide text-white/65">
                {churchName}
              </p>
            )}
          </div>
        )}
      </div>

      {/* Collapse toggle */}
      <button
        type="button"
        onClick={toggle}
        className={cn(
          "absolute right-1 top-1/2 z-10 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-sidebar bg-sidebar text-white/70 shadow-sm",
          "transition-all hover:bg-sidebar-accent hover:text-white hover:shadow-md",
          "opacity-0 group-hover/sidebar:opacity-100 focus-visible:opacity-100",
        )}
        aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        {collapsed ? (
          <ChevronRight className="size-3.5" />
        ) : (
          <ChevronLeft className="size-3.5" />
        )}
      </button>

      {/* Nav items */}
      <nav
        className={cn(
          "min-h-0 flex-1 overflow-y-auto overscroll-contain p-3",
          collapsed && "flex flex-col items-center px-2",
        )}
      >
        {!collapsed && (
          <p className="px-4 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.22em] text-sidebar-accent">
            Ministry Tools
          </p>
        )}
        <div className="space-y-1.5">
          {navItemsForSidebar.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;

            return (
              <Link
                key={item.href}
                href={item.href}
                title={collapsed ? item.label : undefined}
                className={cn(
                  "group relative flex items-center gap-3 rounded-lg text-sm font-semibold transition-all",
                  collapsed ? "size-11 justify-center" : "w-full px-4 py-3",
                  active
                    ? "bg-sidebar-accent/15 text-sidebar-accent"
                    : "text-white/82 hover:bg-brand-lightGold/15 hover:text-white",
                )}
              >
                {/* Active accent rail */}
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

                {!collapsed && (
                  <span className="truncate">{item.label}</span>
                )}
              </Link>
            );
          })}
        </div>

      </nav>

      {/* User footer */}
      <div
        className={cn(
          "shrink-0 border-t border-sidebar p-3",
          collapsed && "flex flex-col items-center gap-2 px-2",
        )}
      >
        {collapsed ? (
          <>
            {showAdminLink && (
              <Link
                href="/admin"
                title="Admin dashboard"
                aria-label="Admin dashboard"
                className="flex size-10 items-center justify-center rounded-xl text-white/75 transition-colors hover:bg-brand-lightGold/15 hover:text-white"
              >
                <ShieldCheck className="size-5" strokeWidth={1.75} />
              </Link>
            )}
            <div
              className="flex size-10 items-center justify-center rounded-full bg-sidebar-accent text-sm font-bold text-white"
              title={userEmail}
              aria-hidden
            >
              {initial}
            </div>
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                title="Sign out"
                aria-label="Sign out"
                className="flex size-10 items-center justify-center rounded-xl text-white/75 transition-colors hover:bg-brand-lightGold/15 hover:text-white"
              >
                <LogOut className="size-5" strokeWidth={1.75} />
              </button>
            </form>
          </>
        ) : (
          <div className="space-y-2">
            {showAdminLink && (
              <Link
                href="/admin"
                className="flex min-h-10 items-center justify-center gap-2 rounded-xl border border-sidebar-accent/30 bg-sidebar-accent/10 px-3 text-sm font-semibold text-sidebar-accent transition-colors hover:bg-sidebar-accent/20"
              >
                <ShieldCheck className="size-4" strokeWidth={1.75} />
                Admin dashboard
              </Link>
            )}
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
                <p className="truncate text-xs capitalize text-white/60">
                  {role ?? "Member"}
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
        )}
      </div>
    </aside>
  );
}
