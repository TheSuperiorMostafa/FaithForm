import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * The shared dashboard shell stays mounted while this route-level fallback is
 * streamed. Its stable block sizes mirror the common page shape to avoid a
 * blank wait or a large layout shift as primary content arrives.
 */
export function DashboardRouteLoading() {
  return (
    <div
      className="mx-auto flex w-full max-w-5xl flex-col gap-5"
      role="status"
      aria-label="Loading dashboard page"
    >
      <div className="space-y-2">
        <Skeleton className="h-8 w-56" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <Card key={index} className="space-y-3 p-5">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-9 w-32" />
            <Skeleton className="h-3 w-20" />
          </Card>
        ))}
      </div>

      <Card className="space-y-4 p-5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
        <Skeleton className="h-16 w-full" />
      </Card>
      <span className="sr-only">Loading…</span>
    </div>
  );
}
