import { ArrowLeft, Globe } from "lucide-react";

import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer, SkeletonText } from "@/components/ui/skeleton";

/** Shares the address workspace’s container, progress grid, and card geometry. */
export default function WebsiteDomainLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-6" label="web address">
      <div className="flex flex-col gap-3">
        <span className="inline-flex min-h-11 w-fit items-center gap-2 px-2 text-[15px] font-semibold text-muted-foreground"><ArrowLeft className="size-4" aria-hidden />Back to Overview</span>
        <SectionHeader title="Your web address" description="Connect your church’s address, check it, then publish when you’re ready." />
      </div>
      <ol aria-label="Website setup" className="grid gap-3 sm:grid-cols-3">
        {["Choose an address", "Connect your address", "Publish your website"].map((label, index) => <li key={label} className="flex items-center gap-3 rounded-2xl border border-border bg-card p-4"><span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-sm font-bold">{index + 1}</span><span className="text-sm font-semibold">{label}</span></li>)}
      </ol>
      <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-4"><div className="min-w-0 flex-1"><h3 className="font-heading text-lg font-bold">Your website address</h3><SkeletonText className="mt-2 max-w-xl" lines={2} size="base" /></div><Skeleton className="h-7 w-32 rounded-full" /></div>
        <div className="mt-4 flex flex-col gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3 sm:flex-row sm:flex-wrap sm:items-center"><div className="flex w-full min-w-0 items-start gap-3 sm:min-w-56 sm:flex-1"><Globe className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden /><Skeleton className="h-6 w-full max-w-sm" /></div><Skeleton className="h-11 w-full rounded-lg sm:w-36" /></div>
        <SkeletonText className="mt-3 max-w-xl" lines={1} size="sm" />
      </section>
      <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><Skeleton className="h-6 w-52" /><SkeletonText className="mt-3 max-w-xl" lines={2} /></div><Skeleton className="h-7 w-36 rounded-full" /></div>
        <div className="mt-4 rounded-xl border border-border bg-muted/30 px-4 py-3"><p className="text-[15px] font-semibold">Connection progress</p><SkeletonText className="mt-2 max-w-xl" lines={2} /></div>
        <div className="mt-5 grid gap-3 md:grid-cols-3">{Array.from({ length: 3 }, (_, index) => <div key={index} className="rounded-xl border border-border bg-background p-4"><Skeleton className="size-10 rounded-xl" /><Skeleton className="mt-3 h-5 w-4/5" /><SkeletonText className="mt-3" lines={2} size="sm" /></div>)}</div>
        <div className="mt-5 flex flex-wrap gap-3"><Skeleton className="h-11 w-36 rounded-lg" /><Skeleton className="h-11 w-48 rounded-lg" /></div>
      </section>
    </SkeletonContainer>
  );
}
