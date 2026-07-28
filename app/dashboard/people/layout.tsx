import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";

export default function PeopleLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="people">{children}</FeatureGate>;
}
