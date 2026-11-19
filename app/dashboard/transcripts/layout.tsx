import type { ReactNode } from "react";

import { FeatureGate } from "@/components/dashboard/feature-gate";

/**
 * Transcripts uses Live Stream recordings, so both switches must be on. Every
 * page underneath also stops early with pageFeatureBlocked, so nothing is read
 * while the gate shows its locked card.
 */
export default function TranscriptsLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureGate feature="live_stream">
      <FeatureGate feature="sermon_media">{children}</FeatureGate>
    </FeatureGate>
  );
}
