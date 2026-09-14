import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";

/** Check-in setup belongs to Attendance; changing it is further limited to admins. */
export default function AttendanceSetupLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="attendance">{children}</FeatureGate>;
}
