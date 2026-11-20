import { ArrowLeft, Clapperboard, Heading, Music, NotebookPen, Plus, Printer, Send } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/** Mirrors the plan editor: header and actions, the order list, and the right rail. */
export default function PlanLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-6" label="plan">
      <div className="flex flex-col gap-4">
        <span aria-hidden className={cn(buttonVariants({ variant: "link" }), "w-fit")}>
          <ArrowLeft className="size-4" />
          <Skeleton className="h-4 w-32" />
        </span>
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <Skeleton className="h-9 w-80 max-w-full" />
            <div className="flex gap-2">
              <Skeleton className="h-11 w-36 rounded-full" />
              <Skeleton className="h-11 w-36 rounded-full" />
            </div>
          </div>
          <div aria-hidden className="flex flex-wrap gap-3">
            <span className={buttonVariants({ variant: "outline" })}>
              <NotebookPen />
              Plan notes
            </span>
            <span className={buttonVariants({ variant: "outline" })}>
              <Printer />
              Print
            </span>
            <span className={buttonVariants()}>
              <Send />
              Share
            </span>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="space-y-3">
          <span className="font-heading text-xl font-bold">Order of service</span>
          <ul aria-hidden className="divide-y divide-border overflow-hidden rounded-3xl border border-border bg-card shadow-sm">
            {Array.from({ length: 10 }).map((_, i) => (
              <li key={i} className="grid min-h-14 grid-cols-[44px_64px_minmax(0,1fr)_auto] items-center gap-x-2 px-2 py-1.5 sm:grid-cols-[44px_72px_28px_minmax(0,1fr)_auto_64px_16px] sm:gap-x-3">
                <Skeleton className="mx-auto size-5" />
                <Skeleton className="h-4 w-14" />
                <Skeleton className="hidden size-5 sm:block" />
                <Skeleton className="h-5 w-48 max-w-full" />
                <Skeleton className="size-9 rounded-full" />
                <Skeleton className="hidden h-4 w-10 justify-self-end sm:block" />
                <span className="hidden sm:block" />
              </li>
            ))}
          </ul>
          <div aria-hidden className="flex flex-wrap gap-2">
            {[
              [Plus, "Item"],
              [Music, "Song"],
              [Heading, "Header"],
              [Clapperboard, "Media"],
            ].map(([Icon, label]) => {
              const I = Icon as typeof Plus;
              return (
                <span key={label as string} className={buttonVariants({ variant: "outline" })}>
                  <I />
                  {label as string}
                </span>
              );
            })}
          </div>
          <Skeleton className="h-14 w-full rounded-2xl" />
        </div>
        <div className="flex flex-col gap-6">
          <div className="space-y-3 rounded-2xl border border-border bg-card p-5 shadow-sm">
            <span className="font-heading text-lg font-bold">Team for this plan</span>
            <Skeleton className="h-16 w-full rounded-xl" />
            <Skeleton className="h-16 w-full rounded-xl" />
          </div>
          <div className="space-y-2 rounded-2xl border border-border bg-card p-5 shadow-sm">
            <span className="font-heading text-lg font-bold">Running total</span>
            <Skeleton className="h-9 w-24" />
            <Skeleton className="h-2 w-full rounded-full" />
          </div>
        </div>
      </div>
    </SkeletonContainer>
  );
}
