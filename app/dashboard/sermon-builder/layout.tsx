import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";

export default function SermonBuilderLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="sermon_builder">{children}</FeatureGate>;
}
