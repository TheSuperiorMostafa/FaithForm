import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { LiveNoteSkeleton, SitePreviewSkeleton } from "@/components/website-admin/skeletons";

/** Mirrors Website → Pages: section list beside the 520px preview. */
export default function WebsitePagesLoading() {
  return (
    <SkeletonContainer
      className="grid w-full gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]"
      label="website pages"
    >
      <div className="flex min-w-0 flex-col gap-4">
        <LiveNoteSkeleton />

        <p className="text-[15px] text-muted-foreground">
          Each block below is one part of your home page, top to bottom. Choose
          Edit to change its words and photos, move it up or down, or switch it
          off to hide it. The preview updates after each change saves.
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

      <SitePreviewSkeleton sticky />
    </SkeletonContainer>
  );
}
