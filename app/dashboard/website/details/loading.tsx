import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";
import {
  FieldSkeleton,
  LiveNoteSkeleton,
  PanelSkeleton,
  SitePreviewSkeleton,
} from "@/components/website-admin/skeletons";

const SHARED_NOTE = "Also shown in Settings → Church info.";

/** Mirrors Website → Look & Details: the Details / Look switch and the details panels, beside the preview. */
export default function WebsiteDetailsLoading() {
  return (
    <SkeletonContainer
      className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,480px)]"
      label="website look and details"
    >
      <div className="flex min-w-0 flex-col gap-6">
        <LiveNoteSkeleton />

        <div className="inline-flex w-fit gap-1 rounded-xl border border-border bg-card p-1 shadow-card dark:shadow-none">
          <span className="inline-flex min-h-11 items-center rounded-lg bg-primary px-6 text-[15px] font-semibold text-primary-foreground">
            Details
          </span>
          <span className="inline-flex min-h-11 items-center rounded-lg px-6 text-[15px] font-semibold text-foreground/80">
            Look
          </span>
        </div>

        <div className="space-y-1">
          <h2 className="font-heading text-xl font-bold">Details</h2>
          <p className="max-w-xl text-[15px] text-muted-foreground">
            What your website says about your church. These details are
            shared: changing a service time also updates the app, attendance,
            and what your phone assistant tells callers.
          </p>
        </div>

        <PanelSkeleton title="Your church" description={SHARED_NOTE}>
          <FieldSkeleton label="Church name" />
          <FieldSkeleton label="Denomination or sub-line" />
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Logo</span>
            <Skeleton className="size-32 rounded-xl" />
          </div>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-semibold">Cover photo</span>
            <Skeleton className="aspect-[16/9] w-full max-w-md rounded-xl" />
          </div>
        </PanelSkeleton>

        <PanelSkeleton title="Where to find you" description={SHARED_NOTE}>
          <FieldSkeleton label="Street address" />
          <div className="grid gap-4 sm:grid-cols-3">
            <FieldSkeleton label="City" />
            <FieldSkeleton label="State" />
            <FieldSkeleton label="ZIP" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <FieldSkeleton label="Phone" />
            <FieldSkeleton label="Email" />
          </div>
        </PanelSkeleton>

        <PanelSkeleton title="Service times" description={SHARED_NOTE}>
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="grid items-center gap-3 rounded-lg border border-border bg-muted/30 p-3 sm:grid-cols-[minmax(0,1fr)_11rem_9rem_auto]"
            >
              <Skeleton className="h-12 w-full rounded-[10px]" />
              <Skeleton className="h-12 w-full rounded-[10px]" />
              <Skeleton className="h-12 w-full rounded-[10px]" />
              <Skeleton className="h-11 w-28 rounded-[10px]" />
            </div>
          ))}
        </PanelSkeleton>

        <PanelSkeleton title="Your team">
          <div className="flex flex-col gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Skeleton className="h-12 w-full rounded-[10px]" />
              <Skeleton className="h-12 w-full rounded-[10px]" />
            </div>
            <SkeletonText lines={2} />
          </div>
        </PanelSkeleton>
      </div>

      <SitePreviewSkeleton sticky />
    </SkeletonContainer>
  );
}
