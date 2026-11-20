import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";

export default function ServicePlansLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="service_plans">{children}</FeatureGate>;
}
