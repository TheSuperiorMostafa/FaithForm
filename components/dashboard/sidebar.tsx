"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import type { FeatureKey } from "@/lib/features/catalog";
import { resolveSidebarLayout } from "@/lib/dashboard/sidebar-layout";
import { cn } from "@/lib/utils";
import {
  navItems,
  filterNavByFeatures,
  footerUtilityNavItems,
} from "./nav-items";
import { useSidebarHoverIntent } from "./use-sidebar-hover-intent";

type SidebarProps = {
  userEmail: string;
  churchName: string | null;
  role: string | null;
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
  pending,
  onNavigate,
}: {
  item: (typeof navItems)[number];
  pathname: string;
  collapsed: boolean;
  pending: boolean;
  onNavigate: (href: string) => void;
}) {
  const active = isActive(pathname, item.href);
  const selected = active || pending;
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      title={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      aria-busy={pending || undefined}
      onClick={(event) => {
        if (isModifiedClick(event) || active) return;
        onNavigate(item.href);
      }}
      className={cn(
        "group relative flex h-11 w-full min-w-0 items-center overflow-hidden rounded-lg text-sm font-semibold",
        selected
          ? "bg-sidebar-accent/15 text-sidebar-accent"
          : "text-white/82 hover:bg-brand-lightGold/15 hover:text-white",
      )}
    >
      <span
        className={cn(
          "absolute left-0 top-1/2 h-7 w-1 -translate-y-1/2 rounded-r-full bg-sidebar-accent",
          selected ? "opacity-100" : "opacity-0",
        )}
        aria-hidden
      />

      <span className="flex size-11 shrink-0 items-center justify-center">
        <Icon
          className={cn(
            "size-[22px] shrink-0",
            selected && "text-sidebar-accent",
          )}
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
      {pending && (
        <span
          className="mr-3 size-1.5 shrink-0 animate-pulse rounded-full bg-sidebar-accent"
          aria-hidden
        />
      )}
    </Link>
  );
}

function isModifiedClick(event: MouseEvent<HTMLAnchorElement>) {
  return (
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

export function Sidebar({
  userEmail,
  churchName,
  role,
  allowedFeatures,
}: SidebarProps) {
  const pathname = usePathname();
  const [pendingHref, setPendingHref] = useState<string | null>(null);

  const hoverIntent = useSidebarHoverIntent();
  const { expanded, panelWidth, overlaying } = resolveSidebarLayout({
    hovering: hoverIntent.hovering,
    keyboardFocusWithin: hoverIntent.keyboardFocusWithin,
    touchOpen: hoverIntent.touchOpen,
  });
  const collapsed = !expanded;
  const closeSidebar = hoverIntent.close;

  useEffect(() => {
    setPendingHref(null);
  }, [pathname]);

  // Navigating away is "done here" — retract the overlay instead of leaving it
  // floating over the page the user just landed on.
  useEffect(() => {
    closeSidebar();
  }, [pathname, closeSidebar]);

  // Escape is the expected way out of anything floating over the page.
  useEffect(() => {
    if (!overlaying) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSidebar();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [overlaying, closeSidebar]);

  const initial = (userEmail ?? "F").charAt(0).toUpperCase();
  const navItemsForSidebar = filterNavByFeatures(navItems, allowedFeatures);

  return (
    <aside
      ref={hoverIntent.sidebarRef}
      {...hoverIntent.handlers}
      data-collapsed={collapsed}
      style={{ width: panelWidth }}
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden flex-col overflow-x-hidden overflow-y-hidden border-r border-sidebar bg-sidebar text-sidebar shadow-2xl md:flex",
        "transition-[width] duration-200 ease-out motion-reduce:transition-none",
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
              pending={pendingHref === item.href}
              onNavigate={setPendingHref}
            />
          ))}
        </div>
      </nav>

      {/* Utility + user footer */}
      <div className="shrink-0 space-y-2 overflow-x-hidden border-t border-sidebar p-3">
        <div
          className={cn(
            "flex gap-1.5",
            collapsed ? "flex-col items-center" : "flex-row",
          )}
        >
          {footerUtilityNavItems.map((item) => {
            const active = isActive(pathname, item.href);
            const pending = pendingHref === item.href;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                aria-current={active ? "page" : undefined}
                aria-busy={pending || undefined}
                onClick={(event) => {
                  if (isModifiedClick(event) || active) return;
                  setPendingHref(item.href);
                }}
                className={cn(
                  "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-lg border text-xs font-semibold transition-colors",
                  collapsed ? "size-9" : "h-8 flex-1 px-2",
                  active || pending
                    ? "border-sidebar-accent/40 bg-sidebar-accent/15 text-sidebar-accent"
                    : "border-white/10 bg-white/5 text-white/75 hover:border-white/20 hover:bg-brand-lightGold/15 hover:text-white",
                )}
              >
                <Icon className="size-3.5 shrink-0" strokeWidth={1.75} aria-hidden />
                <span className={cn(collapsed && "sr-only")}>{item.label}</span>
                {pending && (
                  <span
                    className="size-1.5 animate-pulse rounded-full bg-sidebar-accent"
                    aria-hidden
                  />
                )}
              </Link>
            );
          })}
        </div>

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
