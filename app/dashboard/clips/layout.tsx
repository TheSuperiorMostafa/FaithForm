import type { ReactNode } from "react";

import { FeatureGate } from "@/components/dashboard/feature-gate";

/**
 * Clips need recordings (Live Stream) and the church's Transcripts & Clips
 * switch. Each page sets its own root (`flex w-full flex-col gap-8`), so the
 * loading skeletons mirror it exactly.
 */
export default function ClipsLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureGate feature="live_stream">
      <FeatureGate feature="sermon_media">{children}</FeatureGate>
    </FeatureGate>
  );
}
