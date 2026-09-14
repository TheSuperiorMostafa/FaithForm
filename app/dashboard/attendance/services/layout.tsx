import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";

/**
 * Services and their rosters. Gated like the weekly page beside it: every
 * action here already refuses without Attendance, and the page should say so
 * before anyone presses a button.
 */
export default function AttendanceServicesLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="attendance">{children}</FeatureGate>;
}
