import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";
import {
  SectionLinkTabs,
  type SectionLinkTab,
} from "@/components/dashboard/section-link-tabs";

export default async function PeopleLayout({ children }: { children: ReactNode }) {
  const tabs: SectionLinkTab[] = [
    { label: "People", href: "/dashboard/people", match: "exact" },
    { label: "Households", href: "/dashboard/people/households" },
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

        <SectionLinkTabs tabs={tabs} />

        {children}
      </div>
    </FeatureGate>
  );
}
