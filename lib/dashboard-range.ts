import type { DashboardRange } from "@/lib/queries/dashboard";

export function parseDashboardRange(
  value: string | string[] | undefined,
): DashboardRange {
  if (value === "month" || value === "all") return value;
  return "week";
}
