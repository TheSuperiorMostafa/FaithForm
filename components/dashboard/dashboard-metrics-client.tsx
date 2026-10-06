"use client";

import { useSearchParams } from "next/navigation";
import type { DashboardMetrics, DashboardRange } from "@/lib/queries/dashboard";
import { parseDashboardRange } from "@/lib/dashboard-range";
import { HeroHoursSaved } from "./hero-hours-saved";
import { StatRow } from "./stat-row";

export function DashboardMetricsClient({ metrics }: { metrics: DashboardMetrics }) {
  const searchParams = useSearchParams();
  const range = parseDashboardRange(searchParams.get("range") ?? undefined);
  const setRange = (next: DashboardRange) => {
    const url = new URL(window.location.href);
    if (next === "week") url.searchParams.delete("range");
    else url.searchParams.set("range", next);
    // Next's native history integration updates searchParams without a server navigation.
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  };

  return <>
    <HeroHoursSaved data={metrics[range].hours} range={range} onRangeChange={setRange} />
    <StatRow stats={metrics[range].stats} range={range} />
  </>;
}
