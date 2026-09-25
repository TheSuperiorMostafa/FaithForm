import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";
import "./groups.css";

export default function GroupsLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="groups"><div className="groups-workspace w-full">{children}</div></FeatureGate>;
}
