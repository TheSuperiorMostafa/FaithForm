import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { FeatureGate } from "@/components/dashboard/feature-gate";
import { getFeatureAccess } from "@/lib/features/access";

/** Marking a service. Follow-up lives beside it under its own grant. */
export default async function AttendanceRecordLayout({
  children,
}: {
  children: ReactNode;
}) {
  const access = await getFeatureAccess();

  // A pastor granted Follow-up only still lands on /dashboard/attendance from
  // the nav. Send them to the half they can actually open rather than a
  // locked card.
  if (
    access &&
    !access.allowed.includes("attendance") &&
    access.allowed.includes("attendance_follow_up")
  ) {
    redirect("/dashboard/attendance/follow-up");
  }

  return <FeatureGate feature="attendance">{children}</FeatureGate>;
}
