import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/**
 * Mirrors the Go live tab in its most common state (Ready): the one big state
 * card with its three fact rows and the Go live button, then the "Stream from
 * this computer" row. The page title and tabs come from the layout as real
 * text; the row labels here are static, so they are real text too.
 */
export default function LiveStreamingLoading() {
  return (
    <SkeletonContainer className="flex flex-col gap-6" label="Go live">
      <section className="rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8 dark:shadow-none">
        <div className="grid gap-8 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
          <div className="flex min-w-0 flex-col gap-5">
            <Skeleton className="h-[34px] w-24 rounded-full" />
            <div className="flex flex-col gap-2">
              <Skeleton className="h-9 w-72 max-w-full" />
              <Skeleton className="h-5 w-56 max-w-full" />
            </div>
            <dl className="divide-y divide-border border-y border-border">
              {["Video", "Recording", "Showing in"].map((label) => (
                <div
                  key={label}
                  className="flex flex-col gap-1 py-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                >
                  <dt className="text-[15px] text-muted-foreground">{label}</dt>
                  <dd className="flex flex-col gap-1 sm:items-end">
                    <Skeleton className="h-6 w-40" />
                  </dd>
                </div>
              ))}
            </dl>
          </div>
          <div className="flex flex-col justify-center gap-3">
            <Skeleton className="min-h-16 w-full rounded-[10px]" />
            <Skeleton className="mx-auto h-4 w-64 max-w-full" />
            <Skeleton className="mx-auto h-4 w-48 max-w-full" />
          </div>
        </div>
      </section>

      <div className="flex min-h-16 items-center gap-3 rounded-2xl border border-border bg-card px-5 py-4 shadow-card dark:shadow-none">
        <Skeleton className="size-5 rounded-md" />
        <div className="flex flex-col gap-1.5">
          <span className="text-base font-semibold">Stream from this computer</span>
          <span className="text-sm text-muted-foreground">
            No streaming software? Use this computer&apos;s camera or screen instead.
          </span>
        </div>
      </div>
    </SkeletonContainer>
  );
}
