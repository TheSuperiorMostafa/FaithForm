import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";

const card = "flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none";

function Body() {
  return (
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6">
        <Skeleton className="aspect-video w-full rounded-2xl" />
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="min-h-11 w-36 rounded-[10px]" />
          <Skeleton className="h-5 w-40" />
        </div>
        <div className={card}>
          <div className="space-y-1">
            <span className="block font-heading text-lg font-semibold">Start and end</span>
            <Skeleton className="h-5 w-72 max-w-full" />
          </div>
          {["Clip starts", "Clip ends"].map((label) => (
            <div key={label} className="flex flex-col gap-2">
              <span className="text-[15px] font-medium">{label}</span>
              <Skeleton className="min-h-11 w-full max-w-md rounded-[10px]" />
            </div>
          ))}
          <Skeleton className="h-5 w-48" />
        </div>
        <div className={card}>
          <div className="space-y-1">
            <span className="block font-heading text-lg font-semibold">Framing</span>
            <span className="block text-[15px] text-muted-foreground">Reels are tall. Choose what fits in the tall picture.</span>
          </div>
          {["Follow the speaker (automatic)", "Show the whole picture", "Choose the framing"].map((label) => (
            <div key={label} className="flex min-h-[68px] items-center rounded-xl border border-border px-4 py-3">
              <span className="text-[15px] font-medium">{label}</span>
            </div>
          ))}
        </div>
        <div className={card}>
          <div className="space-y-1">
            <span className="block font-heading text-lg font-semibold">Captions</span>
            <span className="block text-[15px] text-muted-foreground">Words on screen help people watching without sound.</span>
          </div>
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="flex items-center gap-2">
              <Skeleton className="h-4 w-14 shrink-0" />
              <Skeleton className="min-h-11 flex-1 rounded-[10px]" />
            </div>
          ))}
        </div>
      </div>

      <div className="flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
          <span className="font-heading text-lg font-semibold">Text for Facebook</span>
          <Skeleton className="min-h-[136px] w-full rounded-[10px]" />
          <Skeleton className="ml-auto h-4 w-20" />
        </div>
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
          <Skeleton className="min-h-11 w-36 rounded-[10px]" />
        </div>
        <div className={card}>
          <div className="space-y-1">
            <span className="block font-heading text-lg font-semibold">Final video</span>
            <span className="block text-[15px] text-muted-foreground">
              This is exactly what will be posted. Watch it all the way through.
            </span>
          </div>
          <SkeletonText lines={1} lastLineWidth="w-4/5" />
          <Skeleton className="min-h-12 w-52 rounded-[10px]" />
        </div>
        <div className={card}>
          <div className="space-y-1">
            <span className="block font-heading text-lg font-semibold">Approve and post</span>
            <SkeletonText lines={1} lastLineWidth="w-4/5" />
          </div>
          <SkeletonText lines={1} lastLineWidth="w-3/4" />
        </div>
      </div>
    </div>
  );
}

/**
 * The clip editor's two columns. Standalone (inside the client editor while it
 * loads) it carries its own loading status; inside loading.tsx the route's
 * SkeletonContainer does.
 */
export function ClipEditorBodySkeleton({ standalone = true }: { standalone?: boolean }) {
  if (!standalone) return <Body />;
  return (
    <SkeletonContainer label="clip">
      <Body />
    </SkeletonContainer>
  );
}
