import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";
import {
  SectionLinkTabs,
  type SectionLinkTab,
} from "@/components/dashboard/section-link-tabs";

const liveStreamTabs: SectionLinkTab[] = [
  {
    label: "Stream",
    href: "/dashboard/live-streaming",
    match: "exact",
  },
  {
    label: "Media",
    href: "/dashboard/live-streaming/media",
    match: "prefix",
  },
];

export default function LiveStreamingLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureGate feature="live_stream">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
        <header>
          <h1 className="font-heading text-2xl font-bold tracking-tight">
            Live Stream
          </h1>
        </header>

        <SectionLinkTabs tabs={liveStreamTabs} />

        {children}
      </div>
    </FeatureGate>
  );
}
