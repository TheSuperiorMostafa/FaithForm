"use client";

import { useEffect, useState } from "react";
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
        Always the rail's 72px, never the expanded width: the sidebar draws over
        this column when it opens rather than pushing it. See
        lib/dashboard/sidebar-layout.ts — a dashboard of tables and charts must
        not reflow because a pointer crossed the nav.
      */}
      <div className="flex h-dvh min-w-0 flex-col overflow-hidden md:ml-[72px]">
        {banner}
        <Topbar avatarUrl={avatarUrl} userEmail={userEmail} churchName={churchName} />

        <main className="flex-1 overflow-y-auto [scrollbar-gutter:stable] p-5 pb-24 md:p-8 md:pb-8">
          {children}
        </main>
      </div>

      <BottomNav allowedFeatures={allowedFeatures} />
    </div>
  );
}
