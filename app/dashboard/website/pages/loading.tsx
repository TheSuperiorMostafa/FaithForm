import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function WebsitePagesLoading() {
  return (
    <div
      className="grid gap-6 md:grid-cols-[300px_1fr]"
      role="status"
      aria-busy="true"
      aria-label="Loading page sections"
    >
      {/* Sections list column */}
      <div className="flex flex-col gap-3">
        <div className="flex items-center justify-between pb-1">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-16" />
        </div>
        <div className="space-y-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="flex items-center justify-between p-3.5 shadow-card dark:shadow-none">
              <div className="flex items-center gap-2.5">
                <Skeleton className="size-4 rounded" />
                <Skeleton className="h-4 w-28" />
              </div>
              <Skeleton className="h-5 w-9 rounded-full" />
            </Card>
          ))}
        </div>
      </div>

      {/* Section editor column */}
      <Card className="p-6 space-y-6 shadow-card dark:shadow-none">
        <div className="flex items-center justify-between border-b border-border pb-4">
          <div className="space-y-1">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-3.5 w-60" />
          </div>
          <Skeleton className="h-9 w-24 rounded-lg" />
        </div>

        <div className="space-y-4">
          <div className="space-y-2">
            <Skeleton className="h-4 w-20" />
            <Skeleton className="h-10 w-full rounded-md" />
          </div>
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-28 w-full rounded-md" />
          </div>
        </div>
      </Card>
      <span className="sr-only">Loading page sections…</span>
    </div>
  );
}
