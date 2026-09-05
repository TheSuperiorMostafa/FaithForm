import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";
import {
  SectionLinkTabs,
  type SectionLinkTab,
} from "@/components/dashboard/section-link-tabs";

const checkinTabs: SectionLinkTab[] = [
  { label: "Today", href: "/dashboard/checkin", match: "exact" },
  { label: "Checkout", href: "/dashboard/checkin/checkout" },
  { label: "Households", href: "/dashboard/checkin/households" },
  { label: "Rooms", href: "/dashboard/checkin/locations" },
  { label: "Stats", href: "/dashboard/checkin/stats" },
];

export default function CheckinLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureGate feature="checkin">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            Check-In
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who is in which room, and who may collect them.
          </p>
        </header>

        <SectionLinkTabs tabs={checkinTabs} />

        {children}
      </div>
    </FeatureGate>
  );
}
