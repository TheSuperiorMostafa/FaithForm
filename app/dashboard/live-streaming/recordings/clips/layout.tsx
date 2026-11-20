import type { ReactNode } from "react";

import { FeatureGate } from "@/components/dashboard/feature-gate";

/**
 * Clips sit under Live > Recordings (the Live layout already checks Live
 * Stream). They also need the church's Transcripts & Clips switch; each page
 * underneath stops early with pageFeatureBlocked while the gate shows.
 */
export default function RecordingClipsLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="sermon_media">{children}</FeatureGate>;
}
