import { ArrowLeft, History } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/**
 * One Sunday's follow-up, loading. Mirrors `[date]/page.tsx` and the board:
 * the way back, the day as the title, then who missed beside the text they'll get.
 */
export default function AttendanceFollowUpDateLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="follow-up">
      <div className="flex flex-col gap-3">
        <span className="inline-flex min-h-11 w-fit items-center gap-2 text-base font-semibold text-muted-foreground">
          <ArrowLeft className="size-5" strokeWidth={1.75} aria-hidden />
          Back to Follow-up
        </span>
        <PageHeader
          title={<Skeleton className="h-9 w-72 max-w-full sm:h-10" />}
          description="Send a friendly text to people who missed. Nothing is sent until you choose."
          secondary={
            <span aria-hidden className={buttonVariants({ variant: "outline" })}>
              <History aria-hidden />
              Message log
            </span>
          }
        />
      </div>

      <div className="flex w-full flex-col gap-6">
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
