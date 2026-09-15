import type { ReactNode } from "react";

/**
 * Households sit under People. The parent layout already gates on the People
 * feature, so this layout does not re-gate — churches that manage their roster
 * can open families here without needing Check-In turned on.
 */
export default function HouseholdsLayout({ children }: { children: ReactNode }) {
  return children;
}
