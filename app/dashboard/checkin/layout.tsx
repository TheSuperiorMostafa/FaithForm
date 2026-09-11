import type { ReactNode } from "react";
import Link from "next/link";
import { FeatureGate } from "@/components/dashboard/feature-gate";
import {
  SectionLinkTabs,
  type SectionLinkTab,
} from "@/components/dashboard/section-link-tabs";

const checkinTabs: SectionLinkTab[] = [
  { label: "Today", href: "/dashboard/checkin", match: "exact" },
  { label: "Checkout", href: "/dashboard/checkin/checkout" },
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
            Who is in which room right now. Households, and who may collect
            whom, are under{" "}
            <Link
              href="/dashboard/people/households"
              className="font-medium text-accent hover:underline"
            >
              People
            </Link>
            .
          </p>
        </header>

        <SectionLinkTabs tabs={checkinTabs} />

        {children}
      </div>
    </FeatureGate>
  );
}
