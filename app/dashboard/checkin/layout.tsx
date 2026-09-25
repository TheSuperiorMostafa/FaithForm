import type { ReactNode } from "react";

import { FeatureGate } from "@/components/dashboard/feature-gate";
import {
  SectionLinkTabs,
  type SectionLinkTab,
} from "@/components/dashboard/section-link-tabs";
import { PageHeader } from "@/components/ui/page-header";
import { CHECKIN_PAGE_DESCRIPTION, CHECKIN_PAGE_TITLE } from "@/components/checkin/copy";

/**
 * The four jobs of the desk, in the order a Sunday goes. The addresses stay
 * as they were (`checkout`, `locations`, `stats`) so bookmarks keep working;
 * only the words changed.
 */
const checkinTabs: SectionLinkTab[] = [
  { label: "Check in", href: "/dashboard/checkin", match: "exact" },
  { label: "Pick up", href: "/dashboard/checkin/checkout" },
  { label: "Rooms", href: "/dashboard/checkin/locations" },
  { label: "Reports", href: "/dashboard/checkin/stats" },
];

/**
 * Kids Check-in has its own row in the sidebar, so it carries its own header
 * and its own four links, and nothing from Attendance above them. Children
 * checked in here still count toward that day's attendance.
 *
 * The dashboard shell sets the page width; this root only stacks.
 */
export default function CheckinLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureGate feature="checkin">
      <div className="flex w-full flex-col gap-8">
        <div className="flex flex-col gap-6">
          <PageHeader title={CHECKIN_PAGE_TITLE} description={CHECKIN_PAGE_DESCRIPTION} />
          <SectionLinkTabs tabs={checkinTabs} label="Kids Check-in" />
        </div>

        {children}
      </div>
    </FeatureGate>
  );
}
