import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";
import {
  SectionLinkTabs,
  type SectionLinkTab,
} from "@/components/dashboard/section-link-tabs";
import { canAccessFeature, getFeatureAccess } from "@/lib/features/access";

export default async function PeopleLayout({ children }: { children: ReactNode }) {
  const access = await getFeatureAccess();

  // Households ship with Check-In. A church without it gets the roster alone
  // rather than a tab that opens onto a locked card.
  const tabs: SectionLinkTab[] = [
    { label: "People", href: "/dashboard/people", match: "exact" },
    ...(canAccessFeature(access, "checkin")
      ? [{ label: "Households", href: "/dashboard/people/households" }]
      : []),
  ];

  return (
    <FeatureGate feature="people">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6">
        <header>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            People
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Everyone on your roster, and the households they belong to.
          </p>
        </header>

        {tabs.length > 1 && <SectionLinkTabs tabs={tabs} />}

        {children}
      </div>
    </FeatureGate>
  );
}
