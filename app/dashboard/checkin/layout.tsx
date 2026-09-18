import type { ReactNode } from "react";
import Link from "next/link";
import { FeatureGate } from "@/components/dashboard/feature-gate";
import {
  SectionLinkTabs,
  type SectionLinkTab,
} from "@/components/dashboard/section-link-tabs";
import { attendanceSectionTabs } from "@/lib/attendance/section-tabs";
import { getFeatureAccess } from "@/lib/features/access";

const checkinTabs: SectionLinkTab[] = [
  { label: "Today", href: "/dashboard/checkin", match: "exact" },
  { label: "Checkout", href: "/dashboard/checkin/checkout" },
  { label: "Rooms", href: "/dashboard/checkin/locations" },
  { label: "Stats", href: "/dashboard/checkin/stats" },
];

/**
 * Kids check-in is a tab of Attendance: a child checked into a room was at
 * church, and counts toward that Sunday like anyone marked on the weekly sheet
 * or checked in by the app. The desk keeps its own grant (`checkin`) and its
 * own tabs underneath the section's.
 */
export default async function CheckinLayout({ children }: { children: ReactNode }) {
  const access = await getFeatureAccess();
  const sectionTabs = attendanceSectionTabs(access?.allowed ?? []);

  return (
    <FeatureGate feature="checkin">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        {sectionTabs.length > 1 ? <SectionLinkTabs tabs={sectionTabs} /> : null}

        <header>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            Kids check-in
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Who is in which room right now. Everyone checked in here counts
            toward that day&apos;s attendance. Households, and who may collect
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
