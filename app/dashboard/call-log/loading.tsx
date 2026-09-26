import { Phone } from "lucide-react";
import { CALL_LOG_DESCRIPTION, CALL_LOG_TITLE } from "@/app/dashboard/call-log/call-view";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/** Mirrors `page.tsx`: header, then compact call rows. */
export default function CallLogLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="phone calls">
      <PageHeader title={CALL_LOG_TITLE} description={CALL_LOG_DESCRIPTION} icon={Phone} />

      <ul className="divide-y divide-border rounded-3xl border border-border bg-card p-2 shadow-sm">
        {Array.from({ length: 6 }).map((_, i) => (
          <li key={i}>
            <div className="flex min-h-11 min-w-0 items-start gap-3 px-3 py-2.5">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="min-w-0 flex-1 space-y-0.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
                  <Skeleton className="h-5 w-40" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-7 w-24 rounded-full" />
                </div>
                <Skeleton className="my-0.5 h-4 w-full max-w-lg" />
                <Skeleton className="my-0.5 h-4 w-2/3 max-w-sm" />
              </div>
            </div>
          </li>
        ))}
      </ul>
    </SkeletonContainer>
  );
}
