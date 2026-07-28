"use client";

import { useState } from "react";
import { BottomNav } from "@/components/dashboard/bottom-nav";
import { DashboardUsageTracker } from "@/components/dashboard/usage-tracker";
import { Sidebar } from "@/components/dashboard/sidebar";
import { Topbar } from "@/components/dashboard/topbar";
import { VoiceAgentAutoSync } from "@/components/dashboard/voice-agent-auto-sync";
import type { FeatureKey } from "@/lib/features/catalog";
import { cn } from "@/lib/utils";

type DashboardShellProps = {
  userEmail: string;
  churchName: string | null;
  role: string | null;
  initialCollapsed: boolean;
  /** Features this member may open — drives which nav rows render. */
  allowedFeatures: FeatureKey[];
  children: React.ReactNode;
};

function setCollapsedCookie(value: boolean) {
  document.cookie = `sidebar:collapsed=${value ? "1" : "0"}; path=/; max-age=${
    60 * 60 * 24 * 365
  }; samesite=lax`;
}

export function DashboardShell({
  userEmail,
  churchName,
  role,
  initialCollapsed,
  allowedFeatures,
  children,
}: DashboardShellProps) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  const handleCollapsedChange = (next: boolean) => {
    setCollapsed(next);
    setCollapsedCookie(next);
  };

  return (
    <div className="h-dvh overflow-hidden bg-background">
      <DashboardUsageTracker />
      <VoiceAgentAutoSync />
      <Sidebar
        userEmail={userEmail}
        churchName={churchName}
        role={role}
        collapsed={collapsed}
        onCollapsedChange={handleCollapsedChange}
        allowedFeatures={allowedFeatures}
      />

      <div
        className={cn(
          "flex h-dvh min-w-0 flex-col overflow-hidden transition-[margin-left] duration-200 ease-out motion-reduce:transition-none",
          collapsed ? "md:ml-[72px]" : "md:ml-64",
        )}
      >
        <Topbar userEmail={userEmail} churchName={churchName} />

        <main className="flex-1 overflow-y-auto p-5 pb-24 md:p-8 md:pb-8">
          {children}
        </main>
      </div>

      <BottomNav allowedFeatures={allowedFeatures} />
    </div>
  );
}
