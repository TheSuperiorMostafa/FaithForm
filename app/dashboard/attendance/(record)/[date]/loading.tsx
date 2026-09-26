import { ArrowLeft } from "lucide-react";

import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/**
 * One Sunday, loading. Counting a Sunday and its saved summary share this
 * shape — the way back, the day as the title, a full-width row of cards, then
 * the list beside a panel — so whichever one arrives, nothing moves. The day
 * itself is data and shimmers; the words around it are real.
 */
export default function AttendanceDateLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="this Sunday">
      <div className="flex flex-col gap-3">
        <span className="inline-flex min-h-11 w-fit items-center gap-2 text-base font-semibold text-muted-foreground">
          <ArrowLeft className="size-5" strokeWidth={1.75} aria-hidden />
          Back to Sunday count
        </span>
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="min-w-0 space-y-1.5">
            <Skeleton className="h-9 w-72 max-w-full sm:h-10" />
            <Skeleton className="h-6 w-80 max-w-full" />
          </div>
        </header>
      </div>

      {/* Either the two ways to count (a new Sunday) or the totals (a saved
          one), sized to the ways to count. */}
      <div className="grid gap-4 sm:grid-cols-2">
        {Array.from({ length: 2 }).map((_, index) => (
          <div
            key={index}
            className="flex min-h-24 items-start gap-3 rounded-2xl border-2 border-border bg-card p-4 shadow-card dark:shadow-none"
          >
            <Skeleton className="size-10 shrink-0 rounded-xl" />
            <span className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-5 w-36" />
              <Skeleton className="h-5 w-full max-w-60" />
            </span>
          </div>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          <Skeleton className="h-12 w-full rounded-[10px]" />
          <div className="flex flex-wrap gap-2">
            <Skeleton className="h-11 flex-1 rounded-[10px]" />
            <Skeleton className="h-11 flex-1 rounded-[10px]" />
          </div>
          <div className="flex flex-col gap-2">
            {Array.from({ length: 7 }).map((_, index) => (
              <div
                key={index}
                className="flex min-h-[4.5rem] items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3 shadow-card dark:shadow-none"
              >
                <Skeleton className="size-11 shrink-0 rounded-full" />
                <Skeleton className="h-5 flex-1" />
                <Skeleton className="h-11 w-[5.5rem] rounded-lg" />
                <Skeleton className="h-11 w-[5.5rem] rounded-lg" />
              </div>
            ))}
          </div>
        </div>

        <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-5 shadow-card lg:p-6 dark:shadow-none">
          <div className="grid grid-cols-3 gap-2 lg:gap-3">
            {Array.from({ length: 3 }).map((_, index) => (
              <Skeleton key={index} className="h-[4.5rem] rounded-xl lg:h-20" />
            ))}
          </div>
          <Skeleton className="h-14 w-full rounded-[10px]" />
        </div>
      </div>
    </SkeletonContainer>
  );
}
