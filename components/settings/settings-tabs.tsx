"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AISettingsForm } from "@/components/settings/ai-settings-form";
import { AnnouncementEmailForm } from "@/components/settings/announcement-email-form";
import { FollowUpMessagesForm } from "@/components/settings/follow-up-messages-form";
import { GivingCard } from "@/components/settings/giving-card";
import { IntegrationsCard } from "@/components/settings/integrations-card";
import type { IntegrationsCardProps } from "@/components/settings/integrations-card";
import { TeamMembersCard } from "@/components/settings/team-members-card";
import type { TeamMembersCardProps } from "@/components/settings/team-members-card";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { ChurchGivingProfile, GivingFundRow } from "@/types/giving";
import type { AnnouncementEmailTemplate } from "@/lib/email/announcement-template";
import type { FeatureKey } from "@/lib/features/catalog";
import type { ChurchSettings } from "@/types/sermon";

type SettingsTabsProps = {
  isAdmin: boolean;
  integrationStatus: IntegrationsCardProps["status"];
  settings: ChurchSettings | null;
  givingProfile: ChurchGivingProfile | null;
  givingFunds: GivingFundRow[];
  followUpTemplates: string[];
  announcementEmailTemplate: AnnouncementEmailTemplate;
  team: Omit<TeamMembersCardProps, "isAdmin">;
  /** Feature-gated tabs are hidden when the viewer can't use them. */
  allowedFeatures: FeatureKey[];
};

function getDefaultTab(
  searchParams: URLSearchParams,
  visibleTabs: string[],
): string {
  if (
    (searchParams.get("stripe_return") || searchParams.get("stripe_refresh")) &&
    visibleTabs.includes("giving")
  ) {
    return "giving";
  }

  const tab = searchParams.get("tab");
  if (tab && visibleTabs.includes(tab)) {
    return tab;
  }

  return "general";
}

function SettingsTabsInner({
  isAdmin,
  integrationStatus,
  settings,
  givingProfile,
  givingFunds,
  followUpTemplates,
  announcementEmailTemplate,
  team,
  allowedFeatures,
}: SettingsTabsProps) {
  const searchParams = useSearchParams();

  const showCommunications = allowedFeatures.includes("announcements");
  const showAttendance = allowedFeatures.includes("attendance");
  const showGiving = allowedFeatures.includes("giving");

  const visibleTabs = [
    "general",
    "team",
    ...(showCommunications ? ["communications"] : []),
    ...(showAttendance ? ["attendance"] : []),
    ...(showGiving ? ["giving"] : []),
  ];

  const defaultTab = getDefaultTab(searchParams, visibleTabs);

  return (
    <Tabs defaultValue={defaultTab} className="flex flex-col gap-4">
      <TabsList className="w-full justify-start overflow-x-auto">
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="team">Team</TabsTrigger>
        {showCommunications && (
          <TabsTrigger value="communications">Communications</TabsTrigger>
        )}
        {showAttendance && (
          <TabsTrigger value="attendance">Attendance</TabsTrigger>
        )}
        {showGiving && <TabsTrigger value="giving">Giving</TabsTrigger>}
      </TabsList>

      <TabsContent value="general" className="mt-0">
        <div className="grid gap-4 lg:grid-cols-2 lg:items-start">
          <div className="lg:col-span-2">
            <IntegrationsCard isAdmin={isAdmin} status={integrationStatus} />
          </div>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Display</CardTitle>
              <CardDescription>Light and dark mode.</CardDescription>
            </CardHeader>
            <CardContent>
              <ThemeToggle variant="segmented" />
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Resources</CardTitle>
              <CardDescription>Documents and support.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {allowedFeatures.includes("library") && (
                <Link
                  href="/dashboard/library"
                  className="rounded-lg border border-border bg-background px-4 py-2.5 text-center text-sm font-semibold text-foreground transition-colors hover:border-accent hover:bg-accent/10"
                >
                  Documents
                </Link>
              )}
              {allowedFeatures.includes("live_stream") && (
                <Link
                  href="/dashboard/live-streaming"
                  className="rounded-lg border border-border bg-background px-4 py-2.5 text-center text-sm font-semibold text-foreground transition-colors hover:border-accent hover:bg-accent/10"
                >
                  Live Streaming
                </Link>
              )}
              <Link
                href="/dashboard/support"
                className="rounded-lg border border-border bg-background px-4 py-2.5 text-center text-sm font-semibold text-foreground transition-colors hover:border-accent hover:bg-accent/10"
              >
                Support
              </Link>
            </CardContent>
          </Card>

          <div className="lg:col-span-2">
            <AISettingsForm settings={settings} isAdmin={isAdmin} />
          </div>
        </div>
      </TabsContent>

      <TabsContent value="team" className="mt-0">
        <TeamMembersCard isAdmin={isAdmin} {...team} />
      </TabsContent>

      <TabsContent value="communications" className="mt-0">
        <AnnouncementEmailForm
          isAdmin={isAdmin}
          template={announcementEmailTemplate}
        />
      </TabsContent>

      <TabsContent value="attendance" className="mt-0">
        <FollowUpMessagesForm
          isAdmin={isAdmin}
          templates={followUpTemplates}
        />
      </TabsContent>

      <TabsContent value="giving" className="mt-0">
        {givingProfile ? (
          <GivingCard
            isAdmin={isAdmin}
            profile={givingProfile}
            funds={givingFunds}
          />
        ) : (
          <Card>
            <CardContent className="py-8 text-center text-sm text-muted-foreground">
              Church giving profile not found.
            </CardContent>
          </Card>
        )}
      </TabsContent>
    </Tabs>
  );
}

export function SettingsTabs(props: SettingsTabsProps) {
  return (
    <Suspense fallback={null}>
      <SettingsTabsInner {...props} />
    </Suspense>
  );
}
