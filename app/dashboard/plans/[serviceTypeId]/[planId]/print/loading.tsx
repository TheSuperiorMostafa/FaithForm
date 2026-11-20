import { ArrowLeft, Download, Printer } from "lucide-react";

import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PRESETS = ["Order of service", "Full plan", "Team view", "Person view"];
const TOGGLES: { label: string; on: boolean }[] = [
  { label: "Start times", on: true },
  { label: "Lengths", on: false },
  { label: "Who leads", on: false },
  { label: "Descriptions", on: false },
  { label: "Landscape page", on: false },
];

/**
 * Mirrors `page.tsx` and `PrintPreview` as first drawn (Order of service):
 * back link, header, the options card and the preview frame. The service
 * time picker only appears for plans with several times, so it is not drawn.
 */
export default function PrintPlanLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="print options">
      <span className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground">
        <ArrowLeft aria-hidden className="size-5" />
        Back to plan
      </span>
      <PageHeader
        title="Print this plan"
        description="Choose who it's for and what to show, check the preview, then download the PDF."
        icon={Printer}
      />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,22rem)_minmax(0,1fr)]">
        <div
          aria-hidden
          className="flex flex-col gap-6 rounded-2xl border border-border bg-card p-5 shadow-card sm:p-6 dark:shadow-none"
        >
          <h2 className="font-heading text-lg font-semibold text-foreground">What to print</h2>
          <div className="flex flex-col gap-2">
            <div className="grid w-full grid-cols-2 gap-1 rounded-xl border border-border bg-card p-1">
              {PRESETS.map((label, i) => (
                <span
                  key={label}
                  className={cn(
                    "flex min-h-11 items-center justify-center rounded-lg px-4 text-[15px] font-semibold",
                    i === 0 ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
              ))}
            </div>
            <p className="text-[15px] text-muted-foreground">
              Just the running order and times, for the bulletin or the platform.
            </p>
          </div>
          <div className="flex flex-col gap-1">
            <span className="mb-1 text-sm font-semibold text-foreground">Show</span>
            {TOGGLES.map(({ label, on }) => (
              <div key={label} className="flex min-h-11 items-center justify-between gap-4">
                <span className="text-[15px] font-medium text-foreground">{label}</span>
                <span
                  className={cn(
                    "inline-flex h-8 w-14 shrink-0 items-center rounded-full border-2 border-transparent",
                    on ? "bg-accent" : "bg-foreground/25",
                  )}
                >
                  <span
                    className={cn(
                      "block size-6 rounded-full bg-background shadow-sm",
                      on ? "translate-x-6" : "translate-x-0",
                    )}
                  />
                </span>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="font-heading text-lg font-semibold text-foreground">Preview</h2>
            <span aria-hidden className={buttonVariants({ size: "lg" })}>
              <Download className="size-5" />
              Download PDF
            </span>
          </div>
          <div
            aria-hidden
            className="relative flex h-[70vh] min-h-[480px] flex-col gap-4 overflow-hidden rounded-2xl border border-border bg-muted/40 p-8"
          >
            <Skeleton className="h-6 w-48" />
            <Skeleton className="h-4 w-72 max-w-full" />
            <Skeleton className="h-1 w-full" />
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-5 w-full" />
            ))}
          </div>
        </div>
      </div>
    </SkeletonContainer>
  );
}
