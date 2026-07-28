import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";

export default function CallLogLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="voice_assistant">{children}</FeatureGate>;
}
