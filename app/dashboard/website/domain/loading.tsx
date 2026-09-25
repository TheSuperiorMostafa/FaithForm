import { ArrowLeft } from "lucide-react";

import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

/** Mirrors Website → Your web address. */
export default function WebsiteDomainLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-6" label="web address">
      <div className="flex flex-col gap-3">
        <span className="inline-flex min-h-11 w-fit items-center gap-2 px-2 text-[15px] font-semibold text-muted-foreground">
          <ArrowLeft className="size-4" aria-hidden />
          Back to Overview
        </span>
        <SectionHeader
          title="Your web address"
          description="Where people find your website. Your free FaithForm address always works; you can also use your own."
        />
      </div>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <h3 className="font-heading text-lg font-bold">Address that works today</h3>
        <Skeleton className="mt-1.5 h-5 w-full max-w-lg" />
        <Skeleton className="mt-4 h-[62px] w-full rounded-xl" />
      </section>

      <section className="rounded-2xl border border-border bg-card p-6 shadow-card">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-5 w-full max-w-md" />
          </div>
          <Skeleton className="h-8 w-40 rounded-full" />
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-40 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </section>
    </SkeletonContainer>
  );
}
