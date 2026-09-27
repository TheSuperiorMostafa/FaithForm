import type { SeriesWeek } from "@/types/sermon";

export type LinkedSeriesSermon = {
  id: string;
  title: string;
  scripture_refs: string[];
  created_at: string;
  series_week: number | null;
};

function comparable(value: string): string {
  return value.trim().toLowerCase().replace(/[–—]/g, "-").replace(/\s+/g, " ");
}

/** Older sermons have a series id but no saved week. Match only unambiguous plans. */
export function groupSeriesSermons<T extends LinkedSeriesSermon>(
  weeks: SeriesWeek[],
  sermons: T[],
): { byWeek: Map<number, T[]>; other: T[] } {
  const byWeek = new Map(weeks.map((week) => [week.week, [] as T[]]));
  const other: T[] = [];

  for (const sermon of [...sermons].sort((a, b) => b.created_at.localeCompare(a.created_at))) {
    let weekNumber = sermon.series_week;
    if (weekNumber == null) {
      const titleMatches = weeks.filter((week) => comparable(week.title) === comparable(sermon.title));
      if (titleMatches.length === 1) {
        weekNumber = titleMatches[0].week;
      } else {
        const scriptureMatches = weeks.filter((week) =>
          sermon.scripture_refs.some((ref) => comparable(ref) === comparable(week.scripture)),
        );
        if (scriptureMatches.length === 1) weekNumber = scriptureMatches[0].week;
      }
    }
    const matched = weekNumber == null ? undefined : byWeek.get(weekNumber);
    if (matched) matched.push(sermon);
    else other.push(sermon);
  }

  return { byWeek, other };
}
