import type { ReactNode } from "react";
import { Globe } from "lucide-react";

import { FeatureGate } from "@/components/dashboard/feature-gate";
import { SectionLinkTabs } from "@/components/dashboard/section-link-tabs";
import { PageHeader } from "@/components/ui/page-header";

/**
 * Five places, in the order a church uses them. The web address lives on the
 * Overview (and its own page, /domain, reached from there); the look of the
 * site sits with the church's details because both are "how we come across".
 * The old /design and /messages routes redirect, so bookmarks keep working.
 */
const WEBSITE_TABS = [
  { label: "Overview", href: "/dashboard/website", match: "exact" as const, also: ["/dashboard/website/domain"] },
  { label: "Pages", href: "/dashboard/website/pages" },
  { label: "Look & details", href: "/dashboard/website/details" },
  { label: "Sermons", href: "/dashboard/website/sermons" },
  { label: "Inbox", href: "/dashboard/website/inbox" },
];

export default function WebsiteLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureGate feature="website">
      <div className="flex w-full flex-col gap-8">
        <PageHeader
          title="Website"
          icon={Globe}
          description="Your church's public website: its pages, look, sermons, and the messages visitors send you."
        />

        <SectionLinkTabs tabs={WEBSITE_TABS} label="Website sections" />

        {children}
      </div>
    </FeatureGate>
  );
}
