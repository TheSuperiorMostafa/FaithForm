import { ArrowLeft } from "lucide-react";

import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { ATTENDANCE_COPY } from "@/lib/attendance/page-copy";

/** Message log, loading. Mirrors `follow-up/log/page.tsx`: one card per Sunday. */
export default function FollowUpLogLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="message log">
      <div className="flex flex-col gap-3">
        <span className="inline-flex min-h-11 w-fit items-center gap-2 text-base font-semibold text-muted-foreground">
          <ArrowLeft className="size-5" strokeWidth={1.75} aria-hidden />
          Back to Follow-up
        </span>
        <PageHeader
          title={ATTENDANCE_COPY.followUpLog.title}
          description={ATTENDANCE_COPY.followUpLog.description}
        />
      </div>

      <div className="flex flex-col gap-3">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-card"
          >
            <div className="flex flex-col gap-2">
              <Skeleton className="h-5 w-64 max-w-full" />
              <Skeleton className="h-4 w-32" />
            </div>
            <Skeleton className="size-5 rounded" />
          </div>
        ))}
      </div>
    </SkeletonContainer>
  );
}
