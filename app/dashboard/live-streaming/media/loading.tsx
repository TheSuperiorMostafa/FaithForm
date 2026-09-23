import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

export default function MediaLoading() {
  return (
    <div
      className="flex flex-col gap-6"
      role="status"
      aria-busy="true"
      aria-label="Loading media library"
    >
      <div className="space-y-1">
        <Skeleton className="h-6 w-28" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>

      <div className="space-y-6">
        {Array.from({ length: 2 }).map((_, sectionIdx) => (
          <div key={sectionIdx} className="space-y-3">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-4 w-16" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {Array.from({ length: 3 }).map((_, cardIdx) => (
                <Card key={cardIdx} className="overflow-hidden shadow-card dark:shadow-none space-y-2.5">
                  <Skeleton className="aspect-video w-full rounded-none" />
                  <div className="p-3.5 space-y-1.5">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-24" />
                  </div>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
      <span className="sr-only">Loading media library…</span>
    </div>
  );
}
