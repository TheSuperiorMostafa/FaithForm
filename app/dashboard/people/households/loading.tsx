import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function HouseholdsLoading() {
  return (
    <div
      className="flex flex-col gap-4"
      role="status"
      aria-busy="true"
      aria-label="Loading households"
    >
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-[16rem] flex-1 space-y-2">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-10 w-full rounded-md" />
        </div>
        <Skeleton className="h-10 w-36 rounded-md" />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => (
          <Card key={i} className="p-4 space-y-3 shadow-card dark:shadow-none">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              <Skeleton className="h-6 w-24 rounded-md" />
              <Skeleton className="h-6 w-20 rounded-md" />
              <Skeleton className="h-6 w-28 rounded-md" />
            </div>
          </Card>
        ))}
      </div>
      <span className="sr-only">Loading households…</span>
    </div>
  );
}
