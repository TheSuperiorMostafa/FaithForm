import { AlertTriangle, CheckCircle2, Circle, Loader2, Radio } from "lucide-react";

import { cn } from "@/lib/utils";
import type { RecordingPhase } from "@/lib/stream/recording-model";

const STYLES: Record<RecordingPhase, string> = {
  recording: "bg-red-600 text-white",
  preparing: "bg-primary/10 text-primary dark:bg-accent/15 dark:text-accent",
  ready_to_publish: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-200",
  published: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200",
  needs_attention: "bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-200",
  unpublished: "bg-muted text-muted-foreground",
  deleted: "bg-muted text-muted-foreground",
};

/**
 * A recording's state as a word and an icon — never colour alone, never a
 * status code.
 */
export function RecordingPhaseBadge({
  phase,
  label,
  className,
}: {
  phase: RecordingPhase;
  label: string;
  className?: string;
}) {
  const Icon =
    phase === "recording"
      ? Radio
      : phase === "preparing"
        ? Loader2
        : phase === "published"
          ? CheckCircle2
          : phase === "needs_attention"
            ? AlertTriangle
            : Circle;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold leading-none",
        STYLES[phase],
        className,
      )}
    >
      <Icon
        aria-hidden
        className={cn("size-3.5", phase === "preparing" && "motion-safe:animate-spin")}
        strokeWidth={2.25}
      />
      {label}
    </span>
  );
}
