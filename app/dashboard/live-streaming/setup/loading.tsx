import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";

const STEPS = [
  {
    title: "What do you stream with?",
    description: "Pick the one you use. We'll show just the steps for it.",
  },
  {
    title: "Check your video",
    description: "Start streaming in your software. This turns to Connected on its own.",
  },
  {
    title: "After the service",
    description: "Every service is recorded automatically. What should happen next?",
  },
];

const TOOLS = [
  "OBS Studio",
  "ATEM Mini",
  "vMix",
  "This computer (camera)",
  "Someone else sets it up",
];

/**
 * Mirrors Set up streaming: the section header, the three step cards (their
 * titles and the tool choices are static, so they render as real text) and
 * the folded Advanced section. Only live values — the video check and the
 * saved choices — shimmer.
 */
export default function StreamSetupLoading() {
  return (
    <SkeletonContainer className="flex w-full flex-col gap-8" label="streaming setup">
      <div className="space-y-1">
        <h2 className="font-heading text-xl font-bold text-foreground">Set up streaming</h2>
        <p className="text-[15px] text-muted-foreground">Three steps. You only need to do this once.</p>
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
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {TOOLS.map((tool) => (
                    <div
                      key={tool}
                      className="flex min-h-20 items-center gap-4 rounded-2xl border-2 border-border bg-card p-4"
                    >
                      <Skeleton className="size-11 shrink-0 rounded-xl" />
                      <span className="text-base font-semibold">{tool}</span>
                    </div>
                  ))}
                </div>
                <div className="flex min-h-12 items-center rounded-2xl border border-border bg-card/50 px-5 py-3">
                  <span className="text-[15px] font-semibold">Technical details</span>
                </div>
              </>
            ) : index === 1 ? (
              <div className="flex flex-col gap-4 rounded-2xl border border-border p-5 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <Skeleton className="size-7 rounded-full" />
                  <div className="flex flex-col gap-1.5">
                    <Skeleton className="h-6 w-52" />
                    <Skeleton className="h-4 w-72 max-w-full" />
                  </div>
                </div>
                <Skeleton className="min-h-11 w-36 rounded-[10px]" />
              </div>
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
            Streaming PC pairing, encoder settings, embed code, and how your last service reached YouTube and
            Facebook
          </span>
        </span>
      </div>
    </SkeletonContainer>
  );
}
