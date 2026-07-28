import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";

export default function MediaLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="library">{children}</FeatureGate>;
}
