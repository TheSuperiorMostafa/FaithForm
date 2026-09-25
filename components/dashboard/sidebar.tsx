"use client";

import { ProfileAvatar } from "./profile-avatar";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type MouseEvent } from "react";
import { LogOut } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import type { FeatureKey } from "@/lib/features/catalog";
import { resolveSidebarLayout } from "@/lib/dashboard/sidebar-layout";
import { cn } from "@/lib/utils";
import {
  NAV_GROUP_LABELS,
  navItems,
  filterNavByFeatures,
  footerUtilityNavItems,
  isNavItemActive,
  type NavItem,
} from "./nav-items";
import { useSidebarHoverIntent } from "./use-sidebar-hover-intent";

type SidebarProps = {
  avatarUrl?: string | null;
  userEmail: string;
  churchName: string | null;
  role: string | null;
  allowedFeatures: FeatureKey[];
};

/** Plain words for the stored role. */
export function roleLabel(role: string | null): string {
  if (role === "admin" || role === "owner") return "Admin";
  return "Team member";
}

/* Labels fold away with the rail and come back when it opens. */
const labelVisibility = (collapsed: boolean) =>
  collapsed ? "max-w-0 opacity-0 overflow-hidden" : "max-w-full opacity-100";
const blockVisibility = (collapsed: boolean) => (collapsed ? "hidden" : "block");

function SidebarLink({
  item,
  pathname,
  collapsed,
  pending,
  onNavigate,
}: {
  item: NavItem;
  pathname: string;
  collapsed: boolean;
  pending: boolean;
  onNavigate: (href: string) => void;
}) {
  const active = isNavItemActive(pathname, item);
  const selected = active || pending;
  const Icon = item.icon;

  return (
    <Link
      href={item.href}
      aria-label={collapsed ? item.label : undefined}
      aria-current={active ? "page" : undefined}
      aria-busy={pending || undefined}
      onClick={(event) => {
        if (isModifiedClick(event) || active) return;
        onNavigate(item.href);
      }}
      className={cn(
        "group relative flex h-11 w-full min-w-0 items-center overflow-hidden rounded-xl text-[15px] font-semibold transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent",
        selected
          ? "bg-sidebar-accent/15 text-sidebar-accent"
          : "text-white/85 hover:bg-white/[0.07] hover:text-white",
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
          className={cn("size-[22px] shrink-0", selected && "text-sidebar-accent")}
          strokeWidth={1.75}
          aria-hidden
        />
      </span>

      <span
        className={cn(
          "min-w-0 flex-1 truncate pr-3 transition-[opacity,max-width] duration-200 ease-out motion-reduce:transition-none",
          labelVisibility(collapsed),
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
  avatarUrl,
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
  const visible = filterNavByFeatures(navItems, allowedFeatures);
  const home = visible.filter((item) => item.group === "home");
  const groups = (["weekly", "online"] as const)
    .map((group) => ({ group, items: visible.filter((item) => item.group === group) }))
    .filter(({ items }) => items.length > 0);

  const link = (item: NavItem) => (
    <SidebarLink
      key={item.href}
      item={item}
      pathname={pathname}
      collapsed={collapsed}
      pending={pendingHref === item.href}
      onNavigate={setPendingHref}
    />
  );

  return (
    <aside
      ref={hoverIntent.sidebarRef}
      {...hoverIntent.handlers}
      aria-label="Main"
      data-collapsed={collapsed}
      style={{ "--sidebar-panel": `${panelWidth}px` } as React.CSSProperties}
      className={cn(
        "fixed inset-y-0 left-0 z-30 hidden w-[var(--sidebar-panel)] flex-col overflow-x-hidden overflow-y-hidden border-r border-sidebar bg-sidebar text-sidebar md:flex",
        overlaying && "shadow-2xl",
        "transition-[width] duration-200 ease-out motion-reduce:transition-none",
      )}
    >
      {/* Brand header */}
      <div className="relative h-16 shrink-0 border-b border-sidebar">
        <div className="flex h-full items-center gap-3 pl-3.5 pr-4">
          <div className="flex size-10 shrink-0 items-center justify-center">
            <Logo size={40} priority className="shadow-lg shadow-black/20" />
          </div>
          <div
            className={cn(
              "min-w-0 flex-1 overflow-hidden transition-[opacity,max-width] duration-200 ease-out motion-reduce:transition-none",
              blockVisibility(collapsed),
            )}
          >
            <p className="truncate font-heading text-lg font-bold leading-tight text-sidebar-accent">
              FaithForm
            </p>
            {churchName && (
              <p className="truncate text-sm font-semibold text-white/75">{churchName}</p>
            )}
          </div>
        </div>
      </div>

      {/* Nav items */}
      <nav
        aria-label="Sections"
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain px-3 py-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className="space-y-1">{home.map(link)}</div>
        {groups.map(({ group, items }) => (
          <div key={group} className="mt-2">
            {/*
              Same 24px slot open or closed, so no link moves when the rail
              expands: the heading fades in over a thin rule that fades out.
            */}
            <div className="relative mb-1 h-6">
              <span
                aria-hidden
                className={cn(
                  "absolute inset-x-3 top-1/2 h-px bg-white/15 transition-opacity duration-200 motion-reduce:transition-none",
                  collapsed ? "opacity-100" : "opacity-0",
                )}
              />
              <p
                className={cn(
                  "absolute inset-0 overflow-hidden whitespace-nowrap px-3 text-xs font-bold uppercase leading-6 tracking-[0.14em] text-white/55 transition-opacity duration-200 motion-reduce:transition-none",
                  collapsed ? "opacity-0" : "opacity-100",
                )}
                aria-hidden={collapsed || undefined}
              >
                {NAV_GROUP_LABELS[group]}
              </p>
            </div>
            <div className="space-y-1">{items.map(link)}</div>
          </div>
        ))}
      </nav>

      {/* Help, Settings, account */}
      <div className="shrink-0 space-y-2 overflow-x-hidden border-t border-sidebar px-3 py-2.5">
        {/* Stacked in both states, so Help and Settings never move. */}
        <div className="space-y-1">
          {footerUtilityNavItems.map(link)}
        </div>

        <div className="flex h-14 min-w-0 items-center gap-1 overflow-hidden rounded-xl border border-sidebar bg-white/5 pr-2">
          <div className="flex h-full w-11 shrink-0 items-center justify-center">
            <div
              className="flex size-9 items-center justify-center rounded-full bg-sidebar-accent text-sm font-bold text-brand-navy"
              aria-hidden
            >
              <ProfileAvatar url={avatarUrl} initials={initial} />
            </div>
          </div>
          <div
            className={cn(
              "min-w-0 flex-1 overflow-hidden transition-[opacity,max-width] duration-200 ease-out motion-reduce:transition-none",
              blockVisibility(collapsed),
            )}
          >
            <p className="truncate text-sm font-semibold text-white">{userEmail}</p>
            <p className="truncate text-sm text-white/65">{roleLabel(role)}</p>
          </div>
          <form
            action="/auth/signout"
            method="post"
            className={cn("shrink-0", collapsed && "hidden")}
          >
            <button
              type="submit"
              className="flex min-h-11 items-center gap-1.5 rounded-lg px-2.5 text-sm font-semibold text-white/80 hover:bg-white/[0.08] hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-accent"
            >
              <LogOut className="size-4" strokeWidth={1.75} aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </div>
    </aside>
  );
}
