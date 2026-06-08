"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { AISettingsForm } from "@/components/settings/ai-settings-form";
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
};

function getDefaultTab(searchParams: URLSearchParams): string {
  if (
    searchParams.get("tab") === "giving" ||
    searchParams.get("stripe_return") ||
    searchParams.get("stripe_refresh")
  ) {
    return "giving";
  }
  return "general";
}

function SettingsTabsInner({
  isAdmin,
  integrationStatus,
  settings,
  givingProfile,
  givingFunds,
}: SettingsTabsProps) {
  const searchParams = useSearchParams();
  const defaultTab = getDefaultTab(searchParams);

  return (
    <Tabs defaultValue={defaultTab} className="flex flex-col gap-5">
      <TabsList className="w-full justify-start">
        <TabsTrigger value="general">General</TabsTrigger>
        <TabsTrigger value="giving">Giving</TabsTrigger>
      </TabsList>

      <TabsContent value="general" className="flex flex-col gap-5">
        <IntegrationsCard isAdmin={isAdmin} status={integrationStatus} />

        <Card>
          <CardHeader>
            <CardTitle>Display</CardTitle>
            <CardDescription>Manage light and dark mode preferences.</CardDescription>
          </CardHeader>
          <CardContent>
            <ThemeToggle variant="segmented" />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Resources</CardTitle>
            <CardDescription>Access Documents and Support tools from Settings.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <Link
              href="/dashboard/library"
              className="rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-accent hover:bg-accent/10"
            >
              Documents
            </Link>
            <Link
              href="/dashboard/support"
              className="rounded-lg border border-border bg-background px-4 py-2.5 text-sm font-semibold text-foreground transition-colors hover:border-accent hover:bg-accent/10"
            >
              Support
            </Link>
          </CardContent>
        </Card>

        <AISettingsForm settings={settings} isAdmin={isAdmin} />
      </TabsContent>

      <TabsContent value="giving" className="flex flex-col gap-5">
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
