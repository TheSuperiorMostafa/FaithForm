import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";

export default function GivingLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="giving">{children}</FeatureGate>;
}
