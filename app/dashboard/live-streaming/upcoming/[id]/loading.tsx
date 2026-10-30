import { ArrowLeft } from "lucide-react";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";

export default function UpcomingServiceLoading() {
  return <SkeletonContainer label="upcoming service" className="flex w-full flex-col gap-8">
    <span className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground"><ArrowLeft className="size-4" aria-hidden />All upcoming services</span>
    <div className="flex flex-col gap-3"><StatusBadge tone="working">Upcoming</StatusBadge><Skeleton className="h-10 w-96 max-w-full" /><Skeleton className="h-6 w-96 max-w-full" /></div>
    <div className="grid gap-8 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex min-w-0 flex-col gap-6"><Skeleton className="aspect-video w-full rounded-2xl" /><p className="text-[15px] text-muted-foreground">The video preview will be available in Recordings after this service ends.</p></div>
      <div className="flex min-w-0 flex-col gap-5 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none">
        <div className="flex items-start gap-3"><Skeleton className="size-11 shrink-0 rounded-xl" /><div><h2 className="font-heading text-xl font-semibold">Service details</h2><p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">Prepare the same details and artwork used by your recording.</p></div></div>
        {["Title", "Series"].map(label => <div key={label} className="flex flex-col gap-2"><span className="text-[15px] font-medium">{label}</span><Skeleton className="h-11 w-full rounded-[10px]" /></div>)}
        {["Show it on your church website", "Show it in the FaithForm app"].map(label => <div key={label} className="flex min-h-14 items-start gap-3 rounded-xl border border-border p-4"><Skeleton className="mt-0.5 size-5 shrink-0 rounded-md" /><div className="flex flex-col gap-1"><span className="text-[15px] font-medium">{label}</span><SkeletonText lines={2} size="sm" /></div></div>)}
        <div className="flex flex-col gap-5 rounded-2xl border border-border bg-card p-6"><h3 className="font-heading text-lg font-bold">Artwork</h3><SkeletonText lines={3} size="sm" /><div className="grid gap-5 sm:grid-cols-3">{["Tile", "Wide still", "Series banner"].map(label => <div key={label} className="flex flex-col gap-2"><span className="text-sm font-semibold">{label}</span><Skeleton className="h-28 w-full rounded-lg" /><SkeletonText lines={3} size="sm" /></div>)}</div></div>
        <div className="flex min-h-12 items-center rounded-2xl border border-border bg-card/50 px-5 py-3"><span className="text-[15px] font-semibold">More options</span></div>
        <div className="border-t border-border pt-5"><span className="flex min-h-12 items-center justify-center rounded-[10px] bg-primary text-primary-foreground">Save service details</span></div>
      </div>
    </div>
  </SkeletonContainer>;
}
