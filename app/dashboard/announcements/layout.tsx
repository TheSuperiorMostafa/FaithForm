import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";

export default function AnnouncementsLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="announcements">{children}</FeatureGate>;
}
