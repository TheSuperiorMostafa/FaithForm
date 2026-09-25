import { History } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { ATTENDANCE_COPY } from "@/lib/attendance/page-copy";

/**
 * Follow-up, loading. Mirrors `follow-up/page.tsx` and the board: the real
 * title and Message log link, the Sunday picker, then who missed beside the
 * text they'll get.
 */
export default function AttendanceFollowUpLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="follow-up">
      <PageHeader
        title={ATTENDANCE_COPY.followUp.title}
        description={ATTENDANCE_COPY.followUp.description}
        secondary={
          <span aria-hidden className={buttonVariants({ variant: "outline" })}>
            <History aria-hidden />
            Message log
          </span>
        }
      />

      <div className="flex w-full flex-col gap-6">
        <div className="flex max-w-md flex-col gap-2">
          <p className="text-base font-semibold text-foreground">Which Sunday?</p>
          <Skeleton className="h-12 w-full rounded-[10px]" />
        </div>

        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_24rem] lg:items-start">
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="font-heading text-xl font-bold text-foreground">Who missed this Sunday</p>
              <Skeleton className="h-11 w-60 rounded-[10px]" />
            </div>
            <div className="flex flex-col gap-2">
              {Array.from({ length: 6 }).map((_, index) => (
                <div
                  key={index}
                  className="flex min-h-[4.5rem] items-center gap-4 rounded-2xl border border-border bg-card px-4 py-3 shadow-card dark:shadow-none"
                >
                  <Skeleton className="size-7 shrink-0 rounded-lg" />
                  <div className="flex min-w-0 flex-1 flex-col gap-2">
                    <Skeleton className="h-5 w-44 max-w-full" />
                    <Skeleton className="h-4 w-56 max-w-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
            <p className="font-heading text-lg font-semibold text-foreground">The text they&apos;ll get</p>
            <Skeleton className="h-28 w-full rounded-2xl" />
            <Skeleton className="h-11 w-full rounded-[10px]" />
            <Skeleton className="h-14 w-full rounded-[10px]" />
          </div>
        </div>
      </div>
    </SkeletonContainer>
  );
}
