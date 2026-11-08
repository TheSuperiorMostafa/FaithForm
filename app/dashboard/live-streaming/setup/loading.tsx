import { ChevronDown } from "lucide-react";

import { STREAMING_TOOLS } from "@/components/live-streaming/encoder-docs-card";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

const STEPS = [
  {
    title: "What do you stream with?",
    description: "Connect your equipment once. Then start each service from the equipment you already use.",
  },
  {
    title: "After the service",
    description: "Every service is recorded automatically. What should happen next?",
  },
];

export default function StreamSetupLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="streaming setup">
      <div className="space-y-1">
        <h2 className="font-heading text-xl font-bold text-foreground">Set up streaming</h2>
        <p className="text-[15px] text-muted-foreground">Two steps. You only need to do this once.</p>
      </div>

      <ol className="flex flex-col gap-6">
        {STEPS.map((step, index) => (
          <li
            key={step.title}
            className="flex flex-col gap-5 rounded-3xl border border-border bg-card p-6 shadow-card sm:p-8 dark:shadow-none"
          >
            <div className="flex items-start gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-lg font-bold text-accent-foreground">
                {index + 1}
              </span>
              <div className="flex flex-col gap-1">
                <span className="font-heading text-2xl font-bold">{step.title}</span>
                <span className="text-base text-muted-foreground">{step.description}</span>
              </div>
            </div>
            {index === 0 ? (
              <>
                <div className="choice-grid choice-grid-3">
                  {STREAMING_TOOLS.map((tool) => (
                    <div
                      key={tool.id}
                      className="flex min-h-20 items-center gap-4 rounded-2xl border-2 border-border bg-card p-4"
                    >
                      <span aria-hidden className="size-11 shrink-0 rounded-xl bg-primary/[0.07] dark:bg-accent/15" />
                      <span className="flex min-w-0 flex-col">
                        <span className="text-base font-semibold">{tool.name}</span>
                        <span className="text-sm text-muted-foreground">{tool.blurb}</span>
                      </span>
                    </div>
                  ))}
                </div>
                <div className="flex min-h-12 items-center justify-between gap-3 rounded-2xl border border-border bg-card/50 px-5 py-3">
                  <span className="space-y-0.5">
                    <span className="block text-[15px] font-semibold">Technical details</span>
                    <span className="block text-sm text-muted-foreground">Server address and stream key, one at a time</span>
                  </span>
                  <ChevronDown aria-hidden className="size-5 shrink-0 text-muted-foreground" />
                </div>
                <div className="flex min-h-24 items-center justify-between gap-4 rounded-2xl border border-border p-5">
                  <div className="flex flex-col gap-1">
                    <span className="text-base font-semibold">Go live from your equipment</span>
                    <p className="text-[15px] text-muted-foreground">
                      When on, pressing Start Streaming or On Air makes your service public as soon as video reaches FaithForm.
                      Leave it off to check your video privately on the Go live tab.
                    </p>
                  </div>
                  <Skeleton className="h-8 w-14 shrink-0 rounded-full" />
                </div>
              </>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <Skeleton className="min-h-28 rounded-2xl" />
                <Skeleton className="min-h-28 rounded-2xl" />
              </div>
            )}
          </li>
        ))}
      </ol>

      <div className="flex min-h-12 items-center rounded-2xl border border-border bg-card/50 px-5 py-3">
        <span className="space-y-0.5">
          <span className="block text-[15px] font-semibold">Advanced</span>
          <span className="block text-sm text-muted-foreground">
            Optional remote OBS control, encoder settings, embed code, and how your last service reached YouTube and
            Facebook
          </span>
        </span>
      </div>
    </SkeletonContainer>
  );
}
