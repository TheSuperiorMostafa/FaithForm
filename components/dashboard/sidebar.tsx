"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronLeft, ChevronRight, LogOut, ShieldCheck } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { isBootstrapSuperAdminEmail } from "@/lib/auth/superadmin-emails";
import type { FeatureKey } from "@/lib/features/catalog";
import { cn } from "@/lib/utils";
import {
  navItems,
  churchProfileNavItem,
  filterNavByFeatures,
  footerUtilityNavItems,
} from "./nav-items";

type SidebarProps = {
  userEmail: string;
  churchName: string | null;
  role: string | null;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
  allowedFeatures: FeatureKey[];
};

function isActive(pathname: string, href: string) {
  if (href === "/dashboard") {
    return pathname === "/dashboard";
  }
  return pathname === href || pathname.startsWith(`${href}/`);
}

function SidebarLink({
  item,
  pathname,
  collapsed,
}: {
  item: (typeof navItems)[number];
  pathname: string;
  collapsed: boolean;
}) {
  const active = isActive(pathname, item.href);
  const Icon = item.icon;

  return (
    <Link
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
          className={cn("size-[22px] shrink-0", active && "text-sidebar-accent")}
          strokeWidth={1.75}
          aria-hidden
        />
      </span>

      <span
        className={cn(
          "min-w-0 flex-1 truncate pr-3 transition-[opacity,max-width] duration-200 ease-out motion-reduce:transition-none",
          collapsed ? "max-w-0 opacity-0 overflow-hidden" : "max-w-full opacity-100",
        )}
      >
        {item.label}
      </span>
    </Link>
  );
}

export function Sidebar({
  userEmail,
  churchName,
  role,
  collapsed,
  onCollapsedChange,
  allowedFeatures,
}: SidebarProps) {
  const pathname = usePathname();
  const showAdminLink = isBootstrapSuperAdminEmail(userEmail);

  const initial = (userEmail ?? "F").charAt(0).toUpperCase();
  const navItemsForSidebar = filterNavByFeatures(navItems, allowedFeatures);

  const toggle = () => onCollapsedChange(!collapsed);

  return (
    <aside
      data-collapsed={collapsed}
      className={cn(
        "group/sidebar fixed inset-y-0 left-0 z-30 hidden flex-col overflow-x-hidden overflow-y-hidden border-r border-sidebar bg-sidebar text-sidebar shadow-2xl md:flex",
        "transition-[width] duration-200 ease-out motion-reduce:transition-none",
        collapsed ? "w-[72px]" : "w-64",
      )}
    >
      {/* Brand header */}
      <div className="relative h-[72px] shrink-0 border-b border-sidebar">
        <div
          className={cn(
            "flex h-full items-center px-3",
            collapsed ? "justify-center" : "gap-3 pr-4",
          )}
        >
          <div className="flex size-10 shrink-0 items-center justify-center">
            <Logo size={40} priority className="shadow-lg shadow-black/20" />
          </div>
          <div
            className={cn(
              "min-w-0 overflow-hidden transition-[opacity,max-width] duration-200 ease-out motion-reduce:transition-none",
              collapsed ? "hidden" : "max-w-full flex-1 opacity-100",
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
      </div>

      <button
        type="button"
        onClick={toggle}
        className={cn(
          "absolute top-1/2 z-20 flex size-7 -translate-y-1/2 items-center justify-center rounded-full border border-sidebar bg-sidebar text-white/70 shadow-sm",
          "hover:bg-sidebar-accent hover:text-white hover:shadow-md",
          "opacity-0 group-hover/sidebar:opacity-100 focus-visible:opacity-100",
          collapsed ? "left-1/2 -translate-x-1/2" : "-right-3",
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
      <nav className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain p-3">
        {navItemsForSidebar.length > 0 && (
          <p
            className={cn(
              "h-6 shrink-0 overflow-hidden whitespace-nowrap px-1 pb-1 pt-2 text-[11px] font-bold uppercase tracking-[0.22em] text-sidebar-accent",
              "transition-[opacity,max-width] duration-200 ease-out motion-reduce:transition-none",
              collapsed ? "max-w-0 opacity-0" : "max-w-full opacity-100",
            )}
          >
            Ministry Tools
          </p>
        )}
        <div className="space-y-1.5">
          {navItemsForSidebar.map((item) => (
            <SidebarLink
              key={item.href}
              item={item}
              pathname={pathname}
              collapsed={collapsed}
            />
          ))}
        </div>
      </nav>

      {/* Utility + user footer */}
      <div className="shrink-0 space-y-2 overflow-x-hidden border-t border-sidebar p-3">
        <SidebarLink
          item={churchProfileNavItem}
          pathname={pathname}
          collapsed={collapsed}
        />

        <div
          className={cn(
            "flex gap-1.5",
            collapsed ? "flex-col items-center" : "flex-row",
          )}
        >
          {footerUtilityNavItems.map((item) => {
            const active = isActive(pathname, item.href);
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={cn(
                  "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition-colors",
                  collapsed ? "size-9" : "h-8 flex-1 px-2",
                  active
                    ? "border-sidebar-accent/40 bg-sidebar-accent/15 text-sidebar-accent"
                    : "border-white/10 bg-white/5 text-white/75 hover:border-white/20 hover:bg-brand-lightGold/15 hover:text-white",
                )}
              >
                <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className={cn(collapsed && "sr-only")}>{item.label}</span>
              </Link>
            );
          })}
        </div>

        {showAdminLink && (
          <Link
            href="/admin"
            title="Admin dashboard"
            className="flex h-10 w-full min-w-0 items-center overflow-hidden rounded-xl border border-sidebar-accent/30 bg-sidebar-accent/10 text-sidebar-accent hover:bg-sidebar-accent/20"
          >
            <span className="flex size-11 shrink-0 items-center justify-center">
              <ShieldCheck className="size-4" strokeWidth={1.75} />
            </span>
            <span
              className={cn(
                "min-w-0 flex-1 truncate pr-3 text-sm font-semibold transition-[opacity,max-width] duration-200 ease-out motion-reduce:transition-none",
                collapsed ? "max-w-0 opacity-0" : "max-w-full opacity-100",
              )}
            >
              Admin dashboard
            </span>
          </Link>
        )}

        <div
          className={cn(
            "flex h-[52px] min-w-0 items-center overflow-hidden rounded-xl border border-sidebar bg-white/5 p-2",
            collapsed && "justify-center",
          )}
        >
          <div
            className={cn(
              "flex shrink-0 items-center justify-center",
              collapsed ? "size-9" : "size-11",
            )}
          >
            <div
              className="flex size-9 items-center justify-center rounded-full bg-sidebar-accent text-sm font-bold text-white"
              title={userEmail}
              aria-hidden
            >
              {initial}
            </div>
          </div>
          <div
            className={cn(
              "min-w-0 overflow-hidden transition-[opacity,max-width] duration-200 ease-out motion-reduce:transition-none",
              collapsed ? "hidden" : "max-w-full flex-1 opacity-100",
            )}
          >
            <p className="truncate text-sm font-semibold text-white">{userEmail}</p>
            <p className="truncate text-xs capitalize text-white/60">
              {role ?? "Member"}
            </p>
          </div>
          <form
            action="/auth/signout"
            method="post"
            className={cn("shrink-0", collapsed && "hidden")}
          >
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
