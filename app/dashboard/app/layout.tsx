import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";

export default function MemberAppLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="member_app">{children}</FeatureGate>;
}
