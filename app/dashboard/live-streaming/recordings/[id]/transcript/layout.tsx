import type { ReactNode } from "react";

import { FeatureGate } from "@/components/dashboard/feature-gate";

/**
 * A recording's transcript needs the church's Transcripts & Clips switch on
 * top of Live Stream (checked by the Live layout). The page also stops early
 * with pageFeatureBlocked while the gate shows its locked card.
 */
export default function RecordingTranscriptLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="sermon_media">{children}</FeatureGate>;
}
