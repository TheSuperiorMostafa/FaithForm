"use client";

import Link from "next/link";
import { Minus, TrendingDown, TrendingUp } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatServiceWeek } from "@/lib/checkin/service-week";
import type { LocationHeadcount } from "@/types/checkin";

const RANGES = [4, 8, 13, 26];

/**
 * Week-over-week headcount per room.
 *
 * The trend compares the most recent week against the one before it, and only
 * that: a director asking "are we growing" on a Monday morning means since last
 * Sunday, not since the mean of the range. Rooms with no attendance in the
 * window are absent rather than shown as a row of zeros — an empty row says
 * nothing except that the room exists, which the Rooms tab already covers.
 */
export function LocationStatsTable({
  weeks,
  rows,
  weekCount,
}: {
  weeks: string[];
  rows: LocationHeadcount[];
  weekCount: number;
}) {
  const latest = weeks[weeks.length - 1];
  const previous = weeks[weeks.length - 2];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">Range:</span>
        {RANGES.map((range) => (
          <Link
            key={range}
            href={`/dashboard/checkin/stats?weeks=${range}`}
            className={`rounded-full px-3 py-1 text-sm font-medium transition-colors ${
              range === weekCount
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {range} weeks
          </Link>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Headcount by room</CardTitle>
          <p className="mt-1 text-xs text-muted-foreground">
            Counts everyone who was actually received into a room. A
            pre-check-in nobody turned up for is not counted.
          </p>
        </CardHeader>
        <CardContent>
          {rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No check-ins in this range yet.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="border-b border-border text-xs text-muted-foreground">
                    <th className="sticky left-0 bg-card pb-2 pr-4 font-medium">
                      Room
                    </th>
                    {weeks.map((week) => (
                      <th
                        key={week}
                        className="pb-2 pr-4 text-right font-medium tabular-nums"
                      >
                        {formatServiceWeek(week)}
                      </th>
                    ))}
                    <th className="pb-2 pl-2 text-right font-medium">Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row) => {
                    const now = row.byWeek[latest] ?? 0;
                    const before = previous ? (row.byWeek[previous] ?? 0) : 0;
                    const delta = now - before;

                    return (
                      <tr
                        key={row.locationId}
                        className="border-b border-border/60 last:border-0"
                      >
                        <th
                          scope="row"
                          className="sticky left-0 bg-card py-2.5 pr-4 text-left font-medium"
                        >
                          {row.locationName}
                        </th>
                        {weeks.map((week) => (
                          <td
                            key={week}
                            className="py-2.5 pr-4 text-right tabular-nums text-muted-foreground"
                          >
                            {row.byWeek[week] ?? 0}
                          </td>
                        ))}
                        <td className="py-2.5 pl-2 text-right">
                          <span
                            className={`inline-flex items-center gap-1 font-medium tabular-nums ${
                              delta > 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : delta < 0
                                  ? "text-red-600 dark:text-red-400"
                                  : "text-muted-foreground"
                            }`}
                          >
                            {delta > 0 ? (
                              <TrendingUp className="size-3.5" aria-hidden />
                            ) : delta < 0 ? (
                              <TrendingDown className="size-3.5" aria-hidden />
                            ) : (
                              <Minus className="size-3.5" aria-hidden />
                            )}
                            {delta > 0 ? `+${delta}` : delta}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
