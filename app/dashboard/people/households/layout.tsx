import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";

/**
 * Households are what check-in is built out of: a pickup credential has to
 * belong to one. They are listed under People because that is where a church
 * looks for a family, but they arrive with Check-In and are gated on it.
 */
export default function HouseholdsLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="checkin">{children}</FeatureGate>;
}
