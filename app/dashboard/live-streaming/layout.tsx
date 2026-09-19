import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";
import {
  SectionLinkTabs,
  type SectionLinkTab,
} from "@/components/dashboard/section-link-tabs";

/**
 * The weekly job first (Broadcast), what it produced second (Recordings), the
 * organized library third, and the one-time setup last — where a volunteer on
 * a Sunday morning never has to look at it.
 */
const liveStreamTabs: SectionLinkTab[] = [
  { label: "Broadcast", href: "/dashboard/live-streaming", match: "exact" },
  { label: "Recordings", href: "/dashboard/live-streaming/recordings", match: "prefix" },
  { label: "Library", href: "/dashboard/live-streaming/media", match: "prefix" },
  { label: "Setup", href: "/dashboard/live-streaming/setup", match: "prefix" },
];

export default function LiveStreamingLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureGate feature="live_stream">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6">
        <header>
          <h1 className="font-heading text-2xl font-bold tracking-tight">Live Stream</h1>
        </header>

        <SectionLinkTabs tabs={liveStreamTabs} />

        {children}
      </div>
    </FeatureGate>
  );
}
