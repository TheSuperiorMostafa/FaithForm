"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, LogOut, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/superadmin-emails";
import { cn } from "@/lib/utils";
import { navItems } from "./nav-items";

type SidebarProps = {
  userEmail: string;
  churchName: string | null;
  role: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
};

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Sidebar({
  userEmail,
  churchName,
  role,
  collapsed,
  onCollapsedChange,
}: SidebarProps) {
  const pathname = usePathname();
  const showAdminLink = isBootstrapSuperAdminEmail(userEmail);

  const initial = (userEmail ?? "F").charAt(0).toUpperCase();
  const resourceNavHrefs = new Set(["/dashboard/library"]);
  const navItemsForSidebar = navItems.filter(
    (item) => !resourceNavHrefs.has(item.href),
  );

  const toggle = () => onCollapsedChange(!collapsed);

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "group/sidebar fixed inset-y-0 left-0 z-30 hidden flex-col overflow-x-hidden overflow-y-hidden border-r border-sidebar bg-sidebar text-sidebar shadow-2xl md:flex",
        collapsed ? "w-[72px]" : "w-64",
      )}
    >
      {/* Brand header */}
      <div className="relative h-[72px] shrink-0 border-b border-sidebar">
        <div
          className={cn(
            "flex h-full items-center gap-3 px-3",
            collapsed ? "justify-center" : "pr-4",
          )}
        >
          <div className="flex size-10 shrink-0 items-center justify-center">
            <Logo size={40} priority className="shadow-lg shadow-black/20" />
          </div>
          <div
            className={cn(
              "min-w-0 flex-1 overflow-hidden",
              collapsed && "hidden",
            )}
          >
            <p className="truncate font-heading text-lg font-bold leading-tight text-sidebar-accent">
              FaithForm
            </p>
            {churchName && (
              <p className="truncate text-xs font-semibold uppercase tracking-wide text-white/65">
                {churchName}
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={toggle}
          className={cn(
            "absolute -right-3 top-9 z-20 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-sidebar bg-sidebar text-white/70 shadow-sm",
            "hover:bg-sidebar-accent hover:text-white hover:shadow-md",
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
      </div>

      {/* Nav items */}
      <nav className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3">
        <p
          className={cn(
            "h-6 px-1 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.22em] text-sidebar-accent",
            collapsed && "invisible",
          )}
        >
          Ministry Tools
        </p>
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
                  "group relative flex h-11 w-full min-w-0 items-center overflow-hidden rounded-lg text-sm font-semibold",
                  active
                    ? "bg-sidebar-accent/15 text-sidebar-accent"
                    : "text-white/82 hover:bg-brand-lightGold/15 hover:text-white",
                )}
              >
                <span
                  className={cn(
                    "absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-accent",
                    active ? "opacity-100" : "opacity-0",
                  )}
                  aria-hidden
                />

                <span className="flex size-11 shrink-0 items-center justify-center">
                  <Icon
                    className={cn(
                      "size-[22px] shrink-0",
                      active && "text-sidebar-accent",
                    )}
                    strokeWidth={1.75}
                    aria-hidden
                  />
                </span>

                <span
                  className={cn(
                    "min-w-0 flex-1 truncate pr-3",
                    collapsed && "max-w-0 opacity-0 overflow-hidden",
                  )}
                >
                  {item.label}
                </span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* User footer — single stable layout */}
      <div
        className={cn(
          "shrink-0 space-y-2 overflow-x-hidden border-t border-sidebar",
          collapsed ? "p-2" : "p-3",
        )}
      >
        {showAdminLink && (
          <Link
            href="/admin"
            title="Admin dashboard"
            className={cn(
              "flex h-10 min-w-0 items-center overflow-hidden rounded-xl border border-sidebar-accent/30 bg-sidebar-accent/10 text-sidebar-accent hover:bg-sidebar-accent/20",
              collapsed ? "justify-center" : "gap-2 px-3",
            )}
          >
            <span className="flex size-10 shrink-0 items-center justify-center">
              <ShieldCheck className="size-4" strokeWidth={1.75} />
            </span>
            <span
              className={cn(
                "truncate text-sm font-semibold",
                collapsed && "hidden",
              )}
            >
              Admin dashboard
            </span>
          </Link>
        )}

        <div
          className={cn(
            "min-w-0 overflow-hidden rounded-xl border border-sidebar bg-white/5",
            collapsed
              ? "flex flex-col items-center gap-1.5 p-1.5"
              : "flex h-[52px] items-center gap-3 p-2",
          )}
        >
          <div
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-sidebar-accent text-sm font-bold text-white"
            title={userEmail}
            aria-hidden
          >
            {initial}
          </div>
          <div className={cn("min-w-0 flex-1 overflow-hidden", collapsed && "hidden")}>
            <p className="truncate text-sm font-semibold text-white">{userEmail}</p>
            <p className="truncate text-xs capitalize text-white/60">
              {role ?? "Member"}
            </p>
          </div>
          <form action="/auth/signout" method="post" className="shrink-0">
            <button
              type="submit"
              aria-label="Sign out"
              className="flex size-9 items-center justify-center rounded-lg text-white/70 hover:bg-brand-lightGold/15 hover:text-white"
            >
              <LogOut className="size-4" strokeWidth={1.75} />
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
