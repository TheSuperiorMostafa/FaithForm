import { Phone } from "lucide-react";
import { CALL_LOG_DESCRIPTION, CALL_LOG_TITLE } from "@/app/dashboard/call-log/call-view";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/** Mirrors `page.tsx`: header, the two view tabs, then big call rows. */
export default function CallLogLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="phone calls">
      <PageHeader title={CALL_LOG_TITLE} description={CALL_LOG_DESCRIPTION} icon={Phone} />

      <div>
        <div className="inline-flex min-h-11 items-center gap-1 border-b border-border text-muted-foreground">
          <span className="inline-flex min-h-11 items-center px-4 py-2 text-[15px] font-semibold text-primary dark:text-accent">
            Needs a call back
            <Skeleton className="ml-2 h-4 w-6" />
          </span>
          <span className="inline-flex min-h-11 items-center px-4 py-2 text-[15px] font-semibold">
            All calls
            <Skeleton className="ml-2 h-4 w-8" />
          </span>
        </div>

        <ul className="mt-6 divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex flex-col gap-3 rounded-2xl sm:flex-row sm:items-center">
              <div className="flex min-h-[80px] min-w-0 flex-1 items-start gap-4 px-4 py-4">
                <Skeleton className="size-12 shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex flex-wrap items-center gap-3">
                    <Skeleton className="h-5 w-44" />
                    <Skeleton className="h-4 w-28" />
                  </div>
                  <Skeleton className="h-4 w-full max-w-lg" />
                  <Skeleton className="h-7 w-36 rounded-full" />
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </SkeletonContainer>
  );
}
