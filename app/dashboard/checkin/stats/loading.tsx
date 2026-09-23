import { Card, CardHeader } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function CheckinStatsLoading() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-busy="true"
      aria-label="Loading checkin stats"
    >
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-64" />
        </div>
        <Skeleton className="h-9 w-28 rounded-md" />
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-border p-4">
          <Skeleton className="h-5 w-40" />
        </CardHeader>
        <div className="divide-y divide-border">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="grid grid-cols-6 items-center gap-4 p-4">
              <Skeleton className="col-span-2 h-4 w-3/4" />
              {Array.from({ length: 4 }).map((_, col) => (
                <Skeleton key={col} className="h-4 w-12" />
              ))}
            </div>
          ))}
        </div>
      </Card>
      <span className="sr-only">Loading checkin stats…</span>
    </div>
  );
}
