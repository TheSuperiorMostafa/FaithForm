import {
  NO_CODE_LOG_DESCRIPTION,
  NO_CODE_LOG_TITLE,
  REPORTS_DESCRIPTION,
  REPORTS_TITLE,
} from "@/components/checkin/copy";
import { ReportRangePills } from "@/components/checkin/location-stats-table";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/**
 * Mirrors Reports: the heading and range pills are real (they never change),
 * then the table card with its header row and a few room rows, then the log
 * of releases without a pickup code (its heading is real; the count and rows
 * shimmer).
 */
export default function CheckinStatsLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="reports">
      <div className="flex w-full flex-col gap-6">
        <SectionHeader title={REPORTS_TITLE} description={REPORTS_DESCRIPTION} />
        <ReportRangePills weekCount={-1} />

        <Card className="overflow-hidden">
          <div className="flex items-center gap-6 border-b border-border px-6 py-4 text-sm font-semibold text-muted-foreground">
            <span className="w-40">Room</span>
            <div className="flex flex-1 justify-end gap-8">
              {Array.from({ length: 6 }).map((_, i) => (
                <Skeleton key={i} className="h-5 w-12" />
              ))}
            </div>
            <span className="whitespace-nowrap">Since last week</span>
          </div>
          <div className="divide-y divide-border/60">
            {Array.from({ length: 4 }).map((_, row) => (
              <div key={row} className="flex items-center gap-6 px-6 py-4">
                <Skeleton className="h-5 w-40" />
                <div className="flex flex-1 justify-end gap-8">
                  {Array.from({ length: 6 }).map((_, col) => (
                    <Skeleton key={col} className="h-5 w-12" />
                  ))}
                </div>
                <Skeleton className="h-5 w-16" />
              </div>
            ))}
          </div>
        </Card>
      </div>

      <section className="flex w-full flex-col gap-4">
        <SectionHeader
          title={NO_CODE_LOG_TITLE}
          description={
            <>
              <p>{NO_CODE_LOG_DESCRIPTION}</p>
              <Skeleton className="mt-1 h-5 w-80 max-w-full" />
            </>
          }
        />
        <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
          {Array.from({ length: 3 }).map((_, row) => (
            <li key={row} className="flex min-h-[52px] items-center gap-3 px-3 py-2">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-full max-w-xl" />
              </div>
              <Skeleton className="h-4 w-36 shrink-0" />
            </li>
          ))}
        </ul>
      </section>
    </SkeletonContainer>
  );
}
