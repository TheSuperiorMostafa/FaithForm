import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Church, Info } from "lucide-react";

import { SettingsTabPanel } from "@/app/dashboard/settings/tab-panels";
import { SettingsPageHeader, SettingsTabSkeleton } from "@/components/settings/settings-skeletons";
import { SettingsTabNav } from "@/components/settings/settings-tab-nav";
import {
  REMOVED_SETTINGS_TABS,
  resolveSettingsTab,
  visibleSettingsTabs,
} from "@/components/settings/settings-tabs-config";
import { buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { getChurchAuth } from "@/lib/auth/church";
import { defaultFeatureFlags, getFeatureAccess } from "@/lib/features/access";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function paramReader(query: Record<string, string | string[] | undefined>) {
  return {
    get(name: string): string | null {
      const value = query[name];
      if (Array.isArray(value)) return value[0] ?? null;
      return value ?? null;
    },
  };
}

/**
 * Settings: the church's details, the team, connected accounts, the weekly
 * email and texts, and the app's colors. Light or dark sits at the top. One section at a time, each one
 * linkable with `?tab=`.
 */
export default async function SettingsPage({ searchParams }: PageProps) {
  const [query, auth, featureAccess] = await Promise.all([
    searchParams,
    getChurchAuth(),
    getFeatureAccess(),
  ]);

  if (!auth?.churchId) {
    return (
      <div className="flex w-full flex-col gap-8">
        <SettingsPageHeader />
        <EmptyState
          icon={Church}
          title="Your account isn't connected to a church yet"
          description="Starting a new church on FaithForm? Set it up now, it takes a minute. Joining an existing church? Ask its admin to invite you."
          action={
            <Link href="/setup" className={buttonVariants({ size: "lg" })}>
              Set up your church
            </Link>
          }
        />
      </div>
    );
  }

  const flags = featureAccess?.flags ?? defaultFeatureFlags();
  const allowedFeatures = featureAccess?.allowed ?? [];
  const params = paramReader(query);
  const tabs = visibleSettingsTabs({ isAdmin: auth.isAdmin, allowedFeatures });
  const tab = resolveSettingsTab(params, tabs, {
    givingAvailable: allowedFeatures.includes("giving"),
  });
  // Stripe onboarding now returns to the Giving page; links made before that
  // change still arrive here, so pass them along.
  if (params.get("stripe_return")) redirect("/dashboard/giving?stripe_return=1");
  if (params.get("stripe_refresh")) redirect("/dashboard/giving?stripe_refresh=1");
  // A section that was removed sends old bookmarks to Settings home.
  if (REMOVED_SETTINGS_TABS.includes(params.get("tab")?.trim().toLowerCase() ?? "")) {
    redirect("/dashboard/settings");
  }

  return (
    <div className="flex w-full flex-col gap-8">
      <SettingsPageHeader />
      <SettingsTabNav tabs={tabs} active={tab} />

      {!auth.isAdmin && (
        <p className="flex items-start gap-3 rounded-2xl border border-border bg-muted/40 px-5 py-4 text-[15px] leading-relaxed text-foreground/80">
          <Info className="mt-0.5 size-5 shrink-0 text-accent" strokeWidth={1.75} aria-hidden />
          <span>
            Only church admins can change church details, the team and connected accounts. If
            something needs changing, ask an admin on your team.
          </span>
        </p>
      )}

      {/* Keyed on the section so switching shows that section's skeleton. */}
      <Suspense key={tab} fallback={<SettingsTabSkeleton tab={tab} />}>
        <SettingsTabPanel
          tab={tab}
          context={{ auth, flags, allowedFeatures }}
        />
      </Suspense>
    </div>
  );
}
