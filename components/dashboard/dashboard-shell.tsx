"use client";

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
  return (
    <div className="h-dvh overflow-hidden bg-background">
      <DashboardUsageTracker />
      <VoiceAgentAutoSync />
      <Sidebar
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
        <Topbar userEmail={userEmail} churchName={churchName} />

        <main className="flex-1 overflow-y-auto p-5 pb-24 md:p-8 md:pb-8">
          {children}
        </main>
      </div>

      <BottomNav allowedFeatures={allowedFeatures} />
    </div>
  );
}
