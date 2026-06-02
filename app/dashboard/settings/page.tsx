import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { AISettingsForm } from "@/components/settings/ai-settings-form";
import { GivingCard } from "@/components/settings/giving-card";
import { IntegrationsCard } from "@/components/settings/integrations-card";
import { getGivingFundsForSettings } from "@/app/dashboard/settings/giving-actions";
import { getChurchGivingProfile } from "@/lib/queries/giving";
import { ThemeToggle } from "@/components/theme-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getChurchAuth } from "@/lib/auth/church";
import { getIntegrationStatus } from "@/lib/integrations/tokens";
import { getChurchAISettings } from "@/lib/queries/sermons";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const auth = await getChurchAuth(supabase);
  if (!auth) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center text-sm text-muted-foreground">
        Link your account to a church to manage settings.
      </div>
    );
  }

  const [settings, integrationStatus, givingProfile, givingFunds] =
    await Promise.all([
      getChurchAISettings(auth.churchId),
      getIntegrationStatus(auth.churchId, supabase),
      getChurchGivingProfile(auth.churchId),
      getGivingFundsForSettings(auth.churchId),
    ]);

  return (
    <div className="mx-auto flex w-full max-w-lg flex-col gap-5">
      <div>
        <h1 className="border-l-4 border-accent pl-3 font-heading text-[26px] font-bold">
          Settings
        </h1>
        <p className="text-sm text-muted-foreground">
          Connect services and manage AI preferences for your church.
        </p>
      </div>

      <Suspense fallback={null}>
        <IntegrationsCard isAdmin={auth.isAdmin} status={integrationStatus} />
      </Suspense>

      {givingProfile && (
        <Suspense fallback={null}>
          <GivingCard
            isAdmin={auth.isAdmin}
            profile={givingProfile}
            funds={givingFunds}
          />
        </Suspense>
      )}

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

      <AISettingsForm settings={settings} isAdmin={auth.isAdmin} />
    </div>
  );
}
