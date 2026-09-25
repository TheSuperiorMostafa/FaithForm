import { ChevronDown } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { ATTENDANCE_COPY } from "@/lib/attendance/page-copy";
import { cn } from "@/lib/utils";

/**
 * Sunday count, loading. Mirrors `(record)/page.tsx`: the real title and
 * description, the list of Sunday cards beside the "Pick another date" panel.
 * Only the Sundays themselves shimmer.
 */
export default function AttendanceLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="Sunday count">
      <PageHeader
        title={ATTENDANCE_COPY.sundayCount.title}
        description={ATTENDANCE_COPY.sundayCount.description}
        action={<Skeleton className="h-12 w-44 rounded-[10px]" />}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem] lg:items-start">
        <div className="flex min-w-0 flex-col gap-3">
          {Array.from({ length: 8 }).map((_, index) => (
            <div
              key={index}
              className="flex min-h-24 items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-card dark:shadow-none"
            >
              <Skeleton className="hidden size-12 shrink-0 rounded-xl sm:block" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Skeleton className="h-6 w-48 max-w-full" />
                <Skeleton className="h-5 w-64 max-w-full" />
              </div>
              <Skeleton className="h-8 w-24 shrink-0 rounded-full" />
            </div>
          ))}
          <div
            aria-hidden
            className={cn(buttonVariants({ variant: "outline", size: "lg" }), "pointer-events-none mt-1 w-full")}
          >
            <ChevronDown aria-hidden />
            Show earlier Sundays
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
            <p className="text-base font-semibold text-foreground">Pick another date</p>
            <Skeleton className="h-12 w-full rounded-[10px]" />
          </div>
          <div className="flex flex-col gap-2 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
            <p className="font-heading text-base font-semibold text-foreground">A weekday service?</p>
            <p className="text-[15px] text-muted-foreground">
              Bible study, prayer night and other services are counted on Services.
            </p>
          </div>
        </div>
      </div>
    </SkeletonContainer>
  );
}
