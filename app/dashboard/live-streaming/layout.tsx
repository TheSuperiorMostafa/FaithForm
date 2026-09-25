import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";
import { LIVE_PAGE_DESCRIPTION, LIVE_PAGE_TITLE, LIVE_TABS } from "@/components/live-streaming/live-tabs";
import { SectionLinkTabs } from "@/components/dashboard/section-link-tabs";
import { PageHeader } from "@/components/ui/page-header";

/**
 * The weekly job first (Go live), what it produced second (Recordings), the
 * services coming up third, and the one-time setup last — where a volunteer
 * on a Sunday morning never has to look at it.
 *
 * The header and tabs live here, so every tab's loading skeleton sits under a
 * real title and real tab labels (static-first).
 */
export default function LiveStreamingLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureGate feature="live_stream">
      <div className="flex w-full flex-col gap-8">
        <PageHeader title={LIVE_PAGE_TITLE} description={LIVE_PAGE_DESCRIPTION} />

        <SectionLinkTabs tabs={LIVE_TABS} label="Live sections" />

        {children}
      </div>
    </FeatureGate>
  );
}
