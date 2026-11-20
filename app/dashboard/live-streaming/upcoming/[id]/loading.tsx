import { ArrowLeft } from "lucide-react";
import { ArtworkPanelSkeleton } from "@/components/media/artwork-panel-skeleton";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";

export default function UpcomingServiceLoading() {
  return <SkeletonContainer label="upcoming service" className="flex w-full flex-col gap-8">
    <span className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground"><ArrowLeft className="size-4" aria-hidden />All upcoming services</span>
    <div className="flex flex-col gap-3"><StatusBadge tone="working">Upcoming</StatusBadge><Skeleton className="h-10 w-96 max-w-full" /><Skeleton className="h-6 w-96 max-w-full" /></div>
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] lg:items-start">
      <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-1"><Skeleton className="aspect-video w-full rounded-2xl" /><p className="text-[15px] text-muted-foreground">The video preview will be available in Recordings after this service ends.</p></div>
      <div className="flex min-w-0 flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card lg:col-start-2 lg:row-span-2 lg:row-start-1 dark:shadow-none">
        <div className="flex items-start gap-3"><Skeleton className="size-11 shrink-0 rounded-xl" /><div><h2 className="font-heading text-xl font-semibold">Service details</h2><p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">Prepare the same details and artwork used by your recording.</p></div></div>
        {["Title", "Series"].map(label => <div key={label} className="flex flex-col gap-2"><span className="text-[15px] font-medium">{label}</span><Skeleton className="h-11 w-full rounded-[10px]" /></div>)}
        {["Show it on your church website", "Show it in the FaithForm app"].map(label => <div key={label} className="flex min-h-14 items-start gap-3 rounded-xl border border-border p-4"><Skeleton className="mt-0.5 size-5 shrink-0 rounded-md" /><div className="flex flex-col gap-1"><span className="text-[15px] font-medium">{label}</span><SkeletonText lines={2} size="sm" /></div></div>)}
        <ArtworkPanelSkeleton />
        <div className="-mx-6 -mb-6 flex flex-col gap-3 rounded-b-2xl border-t border-border px-6 pb-6 pt-5"><span className="flex min-h-12 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">Save service details</span><p className="text-sm text-muted-foreground">Artwork saves when you upload or remove an image. More options save with this button.</p></div>
      </div>
      <div className="flex min-h-12 flex-col justify-center rounded-2xl border border-border bg-card/50 px-5 py-3 lg:col-start-1 lg:row-start-2"><span className="text-[15px] font-semibold">More options</span><span className="text-sm text-muted-foreground">Who can watch, speaker and scripture</span></div>
    </div>
  </SkeletonContainer>;
}
