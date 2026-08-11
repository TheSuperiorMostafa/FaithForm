import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";

/** Deciding who gets a check-in text. Granted separately from marking. */
export default function AttendanceFollowUpLayout({
  children,
}: {
  children: ReactNode;
}) {
  return <FeatureGate feature="attendance_follow_up">{children}</FeatureGate>;
}
