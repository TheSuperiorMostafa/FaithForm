import { cn } from "@/lib/utils";

/**
 * One visual language for state across the dashboard. Pair the tone with a
 * word from the canonical vocabulary for the domain (docs/ux audit §8.4) —
 * never a raw enum value.
 *
 * - ready:     can be acted on now (Ready, Ready to publish, Check-in open)
 * - live:      happening right now (Live) — pulses
 * - working:   FaithForm is busy (Processing, Waiting for video, Scheduled)
 * - attention: the person needs to do something (Problem, Payment failed)
 * - done:      finished / public (Published, Posted, Saved, Picked up)
 * - neutral:   informational (Draft, Not published, Cancelled)
 */
export type StatusTone = "ready" | "live" | "working" | "attention" | "done" | "neutral";

const TONES: Record<StatusTone, { chip: string; dot: string }> = {
  ready: {
    chip: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-500/15 dark:text-sky-200 dark:ring-sky-500/30",
    dot: "bg-sky-500",
  },
  live: {
    chip: "bg-red-50 text-red-700 ring-red-200 dark:bg-red-500/15 dark:text-red-200 dark:ring-red-500/30",
    dot: "bg-red-500 animate-pulse motion-reduce:animate-none",
  },
  working: {
    chip: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-500/15 dark:text-amber-200 dark:ring-amber-500/30",
    dot: "bg-amber-500",
  },
  attention: {
    chip: "bg-orange-50 text-orange-800 ring-orange-200 dark:bg-orange-500/15 dark:text-orange-200 dark:ring-orange-500/30",
    dot: "bg-orange-500",
  },
  done: {
    chip: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/15 dark:text-emerald-200 dark:ring-emerald-500/30",
    dot: "bg-emerald-500",
  },
  neutral: {
    chip: "bg-muted text-foreground/75 ring-border",
    dot: "bg-muted-foreground/60",
  },
};

export function StatusBadge({
  tone,
  children,
  className,
  size = "default",
}: {
  tone: StatusTone;
  children: React.ReactNode;
  className?: string;
  size?: "default" | "lg";
}) {
  const t = TONES[tone];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-2 whitespace-nowrap rounded-full font-semibold ring-1 ring-inset",
        size === "lg" ? "px-3.5 py-1.5 text-[15px]" : "px-3 py-1 text-sm",
        t.chip,
        className,
      )}
    >
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", t.dot)} />
      {children}
    </span>
  );
}
