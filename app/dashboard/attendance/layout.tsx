import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";

export default function AttendanceLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="attendance">{children}</FeatureGate>;
}
