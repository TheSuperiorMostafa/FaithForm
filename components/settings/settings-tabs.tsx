"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AISettingsForm } from "@/components/settings/ai-settings-form";
import { FollowUpMessagesForm } from "@/components/settings/follow-up-messages-form";
import { GivingCard } from "@/components/settings/giving-card";
import { IntegrationsCard } from "@/components/settings/integrations-card";
import type { IntegrationsCardProps } from "@/components/settings/integrations-card";
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
import type { ChurchSettings } from "@/types/sermon";

type SettingsTabsProps = {
  isAdmin: boolean;
  integrationStatus: IntegrationsCardProps["status"];
  settings: ChurchSettings | null;
  givingProfile: ChurchGivingProfile | null;
  givingFunds: GivingFundRow[];
  followUpTemplates: string[];
};

function getDefaultTab(searchParams: URLSearchParams): string {
  if (
    searchParams.get("tab") === "giving" ||
    searchParams.get("stripe_return") ||
    searchParams.get("stripe_refresh")
  ) {
    return "giving";
  }
  if (searchParams.get("tab") === "attendance") {
    return "attendance";
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
}: SettingsTabsProps) {
  const searchParams = useSearchParams();
  const defaultTab = getDefaultTab(searchParams);

  return (
    <Tabs defaultValue={defaultTab} className="flex flex-col gap-4">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="attendance">Attendance</TabsTrigger>
        <TabsTrigger value="giving">Giving</TabsTrigger>
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
              <Link
                href="/dashboard/library"
                className="rounded-lg border border-border bg-background px-4 py-2.5 text-center text-sm font-semibold text-foreground transition-colors hover:border-accent hover:bg-accent/10"
              >
                Documents
              </Link>
              <Link
                href="/dashboard/live-streaming"
                className="rounded-lg border border-border bg-background px-4 py-2.5 text-center text-sm font-semibold text-foreground transition-colors hover:border-accent hover:bg-accent/10"
              >
                Live Streaming
              </Link>
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
