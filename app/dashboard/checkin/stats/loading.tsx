import { REPORTS_DESCRIPTION, REPORTS_TITLE } from "@/components/checkin/copy";
import { ReportRangePills } from "@/components/checkin/location-stats-table";
import { Card } from "@/components/ui/card";
import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/**
 * Mirrors Reports: the heading and range pills are real (they never change),
 * then the table card with its header row and a few room rows.
 */
export default function CheckinStatsLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-6" label="reports">
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
    </SkeletonContainer>
  );
}
