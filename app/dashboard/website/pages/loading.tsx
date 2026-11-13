import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { LiveNoteSkeleton, SitePreviewSkeleton } from "@/components/website-admin/skeletons";

/** Mirrors Website → Pages: large preview beside the 340px adjustment panel. */
export default function WebsitePagesLoading() {
  return (
    <SkeletonContainer
      className="flex w-full flex-col gap-4"
      label="website pages"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[15px] text-muted-foreground">Preview your page, then choose a section to adjust its words and photos.</p>
        <span className="inline-flex min-h-11 items-center rounded-lg border border-border px-6 text-sm font-medium">Open full-screen editor</span>
      </div>
      <div className="grid min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <SitePreviewSkeleton sticky />
      <div className="flex min-w-0 flex-col gap-4">
        <LiveNoteSkeleton />

        <p className="text-[15px] text-muted-foreground">
          Each block below is one part of your website. Choose Edit to change
          its words and photos, move it up or down, or switch it off to hide it.
          The preview updates after each change saves.
        </p>

        <div className="flex flex-col gap-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div
              key={i}
              className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card p-4 shadow-card sm:p-5"
            >
              <div className="min-w-0 flex-1 space-y-2">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-6 w-44" />
                  <Skeleton className="h-6 w-20 rounded-full" />
                </div>
                <Skeleton className="h-4 w-40" />
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Skeleton className="h-11 w-28 rounded-[10px]" />
                <Skeleton className="h-11 w-32 rounded-[10px]" />
                <Skeleton className="h-11 w-24 rounded-[10px]" />
                <Skeleton className="h-11 w-20 rounded-[10px]" />
              </div>
            </div>
          ))}
        </div>
      </div>

      </div>
    </SkeletonContainer>
  );
}
