import type { SeriesPlan } from "@/types/sermon";

/** An explicit week must exist in the owned series; coercion would hide bad links. */
export function isValidSeriesWeek(week: unknown, plan: SeriesPlan | null | undefined): week is number {
  return typeof week === "number" && Number.isSafeInteger(week) && week >= 1 && week <= 52 &&
    !!plan?.weeks?.some((item) => item.week === week);
}
