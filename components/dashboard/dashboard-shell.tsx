"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { ConfirmHost } from "@/components/ui/confirm-dialog";
import { cn } from "@/lib/utils";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { DashboardUsageTracker } from "@/components/dashboard/usage-tracker";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { VoiceAgentAutoSync } from "@/components/dashboard/voice-agent-auto-sync";
import type { FeatureKey } from "@/lib/features/catalog";

type DashboardShellProps = {
  userEmail: string;
  churchName: string | null;
  role: string | null;
  /** Features this member may open — drives which nav rows render. */
  allowedFeatures: FeatureKey[];
  /**
   * Rendered above everything, full width. Server-composed so a client shell
   * never has to know what a platform admin is.
   */
  banner?: React.ReactNode;
  children: React.ReactNode;
};

export function DashboardShell({
  userEmail,
  churchName,
  role,
  allowedFeatures,
  banner,
  children,
}: DashboardShellProps) {
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const pathname = usePathname();
  const fullWidth = isFullWidthRoute(pathname);
  useEffect(() => {
    const controller = new AbortController();
    let inFlight = false;
    const refresh = async () => {
      if (document.visibilityState === "hidden" || inFlight) return;
      inFlight = true;
      try {
        const response = await fetch("/api/dashboard/account/profile", { cache: "no-store", signal: controller.signal });
        if (response.ok) setAvatarUrl((await response.json()).avatarUrl ?? null);
        else if (response.status === 401) setAvatarUrl(null);
      } catch { /* Keep the last photo during transient network failures. */ }
      finally { inFlight = false; }
    };
    void refresh();
    const interval = window.setInterval(() => void refresh(), 30_000);
    window.addEventListener("focus", refresh);
    document.addEventListener("visibilitychange", refresh);
    return () => {
      controller.abort();
      window.clearInterval(interval);
      window.removeEventListener("focus", refresh);
      document.removeEventListener("visibilitychange", refresh);
    };
  }, []);
  return (
    <div className="h-dvh overflow-hidden bg-background">
      <a
        href="#main-content"
        className="sr-only z-[60] rounded-xl bg-primary px-4 py-3 font-semibold text-primary-foreground focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
      >
        Skip to main content
      </a>
      <ConfirmHost />
      <DashboardUsageTracker />
      <VoiceAgentAutoSync />
      <Sidebar
        avatarUrl={avatarUrl}
        userEmail={userEmail}
        churchName={churchName}
        role={role}
        allowedFeatures={allowedFeatures}
      />

      {/*
        On tablets, always the rail's 72px, never the expanded width: the
        sidebar draws over this column when it opens rather than pushing it.
        On large screens the sidebar is pinned open and this reserves its full
        256px. See lib/dashboard/sidebar-layout.ts.
      */}
      <div className="flex h-dvh min-w-0 flex-col overflow-hidden md:ml-[72px] lg:ml-[256px]">
        {banner}
        <Topbar avatarUrl={avatarUrl} userEmail={userEmail} churchName={churchName} />

        <main
          id="main-content"
          tabIndex={-1}
          className="flex-1 overflow-y-auto [scrollbar-gutter:stable] px-4 pb-28 pt-6 outline-none sm:px-6 md:px-8 md:pb-10 md:pt-8"
        >
          {/*
            One page width for the whole dashboard, so moving between sections
            never changes where things sit. Announcements is the one exception:
            its month calendar and side panel need the full width.
          */}
          <div
            data-page-width={fullWidth ? "full" : "standard"}
            className={cn("mx-auto w-full", !fullWidth && DASHBOARD_PAGE_WIDTH)}
          >
            {children}
          </div>
        </main>
      </div>

      <BottomNav allowedFeatures={allowedFeatures} />
    </div>
  );
}

/** The one content width every dashboard page uses. */
export const DASHBOARD_PAGE_WIDTH = "max-w-6xl";

/** Routes that use the full content width instead. */
export function isFullWidthRoute(pathname: string): boolean {
  return pathname === "/dashboard/announcements" || pathname.startsWith("/dashboard/announcements/");
}
