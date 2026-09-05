import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";

/**
 * The pastor's half of the phone feature.
 *
 * Configuring the assistant — voice, persona, knowledge, the Retell agent it is
 * bound to — moved to the platform admin dashboard. Churches asked to see what
 * the phone did, not to tune what it is, and every support ticket about the
 * assistant came back to a setting a pastor had no reason to have touched. So
 * this section is the log alone, and there are no tabs above it any more.
 */
export default function CallLogLayout({ children }: { children: ReactNode }) {
  return (
    <FeatureGate feature="voice_assistant">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        {children}
      </div>
    </FeatureGate>
  );
}
