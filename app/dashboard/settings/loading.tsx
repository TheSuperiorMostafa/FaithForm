"use client";

import { useSearchParams } from "next/navigation";

import { SettingsPageHeader, SettingsTabSkeleton } from "@/components/settings/settings-skeletons";
import { SettingsTabNav } from "@/components/settings/settings-tab-nav";
import { SkeletonContainer } from "@/components/ui/skeleton";
import {
  SETTINGS_TABS,
  resolveSettingsTab,
} from "@/components/settings/settings-tabs-config";

/**
 * Mirrors the page exactly: the same header and section links as real text,
 * then the skeleton of whichever section the address asks for. Settings is
 * mostly opened by admins, so every section link is shown.
 */
export default function SettingsLoading() {
  const params = useSearchParams();
  const tabs = SETTINGS_TABS.map((tab) => tab.id);
  const tab = resolveSettingsTab(params, tabs, { givingAvailable: true });

  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="settings">
      <SettingsPageHeader />
      <SettingsTabNav tabs={tabs} active={tab} />
      <SettingsTabSkeleton tab={tab} bare />
    </SkeletonContainer>
  );
}
