import { History } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { ATTENDANCE_COPY } from "@/lib/attendance/page-copy";

/**
 * Follow-up, loading. Mirrors `follow-up/page.tsx`: the real title and
 * Message log link, then the list of counted Sundays.
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

      <div className="flex min-w-0 flex-col gap-3">
        {Array.from({ length: 8 }).map((_, index) => (
          <div
            key={index}
            className="flex min-h-24 items-center gap-4 rounded-2xl border border-border bg-card px-5 py-4 shadow-card dark:shadow-none"
          >
            <Skeleton className="hidden size-12 shrink-0 rounded-xl sm:block" />
            <div className="flex min-w-0 flex-1 flex-col gap-2">
              <Skeleton className="h-6 w-48 max-w-full" />
              <Skeleton className="h-5 w-40 max-w-full" />
            </div>
          </div>
        ))}
      </div>
    </SkeletonContainer>
  );
}
