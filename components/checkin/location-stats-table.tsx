"use client";

import Link from "next/link";
import { BarChart3, Minus, TrendingDown, TrendingUp } from "lucide-react";

import { REPORT_RANGES, REPORTS_DESCRIPTION, REPORTS_TITLE } from "@/components/checkin/copy";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { SectionHeader } from "@/components/ui/page-header";
import { formatServiceWeek } from "@/lib/checkin/service-week";
import { cn } from "@/lib/utils";
import type { LocationHeadcount } from "@/types/checkin";

/** The week-range pills. Shared with the loading skeleton so they match. */
export function ReportRangePills({ weekCount }: { weekCount: number }) {
  return (
    <nav aria-label="How many weeks to show" className="flex flex-wrap items-center gap-2">
      {REPORT_RANGES.map((range) => (
        <Link
          key={range}
          href={`/dashboard/checkin/stats?weeks=${range}`}
          aria-current={range === weekCount ? "page" : undefined}
          className={cn(
            "inline-flex min-h-11 items-center rounded-full border px-5 text-[15px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none",
            range === weekCount
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border bg-card text-foreground/80 hover:border-accent hover:text-foreground",
          )}
        >
          Last {range} weeks
        </Link>
      ))}
    </nav>
  );
}

/**
 * Week-over-week headcount per room.
 *
 * The trend compares the most recent week against the one before it, and only
 * that: a director asking "are we growing" on a Monday morning means since last
 * Sunday. Rooms with no children in the window are left out rather than shown
 * as a row of zeros.
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
    <div className="flex w-full flex-col gap-6">
      <SectionHeader title={REPORTS_TITLE} description={REPORTS_DESCRIPTION} />
      <ReportRangePills weekCount={weekCount} />

      {rows.length === 0 ? (
        <EmptyState
          icon={BarChart3}
          title="No check-ins in these weeks"
          description="When children are checked in to rooms, the numbers for each week show up here."
        />
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[15px]">
              <thead>
                <tr className="border-b border-border text-sm text-muted-foreground">
                  <th scope="col" className="sticky left-0 bg-card px-6 py-4 font-semibold">
                    Room
                  </th>
                  {weeks.map((week) => (
                    <th
                      key={week}
                      scope="col"
                      className="whitespace-nowrap px-4 py-4 text-right font-semibold tabular-nums"
                    >
                      {formatServiceWeek(week)}
                    </th>
                  ))}
                  <th scope="col" className="whitespace-nowrap px-6 py-4 text-right font-semibold">
                    Since last week
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const now = row.byWeek[latest] ?? 0;
                  const before = previous ? (row.byWeek[previous] ?? 0) : 0;
                  const delta = now - before;

                  return (
                    <tr key={row.locationId} className="border-b border-border/60 last:border-0">
                      <th
                        scope="row"
                        className="sticky left-0 bg-card px-6 py-4 text-left font-semibold text-foreground"
                      >
                        {row.locationName}
                      </th>
                      {weeks.map((week) => (
                        <td key={week} className="px-4 py-4 text-right tabular-nums text-foreground/80">
                          {row.byWeek[week] ?? 0}
                        </td>
                      ))}
                      <td className="px-6 py-4 text-right">
                        <span
                          className={cn(
                            "inline-flex items-center gap-1.5 font-semibold tabular-nums",
                            delta > 0
                              ? "text-emerald-700 dark:text-emerald-400"
                              : delta < 0
                                ? "text-red-700 dark:text-red-400"
                                : "text-muted-foreground",
                          )}
                        >
                          {delta > 0 ? (
                            <TrendingUp className="size-4" aria-hidden />
                          ) : delta < 0 ? (
                            <TrendingDown className="size-4" aria-hidden />
                          ) : (
                            <Minus className="size-4" aria-hidden />
                          )}
                          {delta > 0 ? `+${delta}` : delta === 0 ? "Same" : delta}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}
