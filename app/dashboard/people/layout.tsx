import type { ReactNode } from "react";
import { FeatureGate } from "@/components/dashboard/feature-gate";

/**
 * Gate only. Each page draws its own header, because People and Families each
 * have their own title and their own one main button ("Add person",
 * "New family"), and the section links sit under that header.
 */
export default async function PeopleLayout({ children }: { children: ReactNode }) {
  return <FeatureGate feature="people">{children}</FeatureGate>;
}
