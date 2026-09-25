import { ArrowLeft } from "lucide-react";

import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";

/**
 * Mirrors the recording page: back link, status + title + date, then the
 * player (left) and the publish card (right), and the quiet delete section.
 * Static labels ("All recordings", field labels, "Delete recording") are real
 * text; only the recording's own data shimmers.
 */
export default function RecordingReviewLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="recording">
      <span className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground">
        <ArrowLeft className="size-4" aria-hidden />
        All recordings
      </span>

      <div className="flex flex-col gap-3">
        <Skeleton className="h-[34px] w-40 rounded-full" />
        <Skeleton className="h-9 w-96 max-w-full" />
        <Skeleton className="h-5 w-72 max-w-full" />
      </div>

      <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex min-w-0 flex-col gap-6">
          <Skeleton className="aspect-video w-full rounded-2xl" />
          <div className="flex min-h-14 items-center rounded-2xl border border-border bg-card px-5 py-3">
            <span className="text-base font-semibold">Trim the beginning or end</span>
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
            <div className="flex items-start gap-3">
              <Skeleton className="size-11 shrink-0 rounded-xl" />
              <div className="flex flex-1 flex-col gap-2">
                <Skeleton className="h-6 w-48" />
                <SkeletonText lines={2} size="sm" />
              </div>
            </div>
            {["Title", "Series"].map((label) => (
              <div key={label} className="flex flex-col gap-2">
                <span className="text-[15px] font-medium">{label}</span>
                <Skeleton className="h-11 w-full rounded-[10px]" />
              </div>
            ))}
            <Skeleton className="min-h-[88px] w-full rounded-xl" />
            <div className="flex min-h-12 items-center rounded-2xl border border-border bg-card/50 px-5 py-3">
              <span className="text-[15px] font-semibold">More options</span>
            </div>
            <div className="border-t border-border pt-5">
              <Skeleton className="min-h-12 w-full rounded-[10px]" />
            </div>
          </div>
        </div>
      </div>

      <div className="flex flex-col gap-4 rounded-2xl border border-destructive/20 bg-destructive/[0.03] p-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="space-y-1">
          <span className="block font-heading text-lg font-semibold">Delete recording</span>
          <span className="block text-[15px] text-muted-foreground">
            Removes the video from FaithForm, the app and your website for good. To only hide it, unpublish it.
          </span>
        </div>
        <Skeleton className="min-h-11 w-44 shrink-0 rounded-[10px]" />
      </div>
    </SkeletonContainer>
  );
}
