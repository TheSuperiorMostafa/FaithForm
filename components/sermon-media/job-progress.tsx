"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, Loader2, TriangleAlert } from "lucide-react";

import { formatEta, type JobProgress as JobProgressView } from "@/lib/sermon-media/progress";
import { cn } from "@/lib/utils";

/**
 * Live progress for a transcript or video job: stage in plain words, a bar,
 * and time left. Between the worker's updates (about every 10 seconds) the
 * bar creeps forward on the expected pace, never past the next real update's
 * likely value, so it never looks stuck and never jumps backwards.
 */
export function JobProgress({
  progress,
  compact = false,
  className,
}: {
  progress: JobProgressView | null | undefined;
  compact?: boolean;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());
  const working = progress?.state === "working" || progress?.state === "waiting";
  useEffect(() => {
    if (!working) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [working]);
  // When the latest real value arrived; the smoothing restarts from it.
  const stamp = `${progress?.state}|${progress?.label}|${progress?.percent}|${progress?.etaSec}`;
  const [baseline, setBaseline] = useState(() => ({ stamp, at: Date.now() }));
  if (baseline.stamp !== stamp) setBaseline({ stamp, at: now });
  const shownAt = baseline.stamp === stamp ? baseline.at : now;

  if (!progress) return null;

  if (progress.state === "done") {
    return (
      <p className={cn("flex items-center gap-2 text-[15px] text-emerald-700 dark:text-emerald-400", className)}>
        <CheckCircle2 aria-hidden className="size-5" /> Done
      </p>
    );
  }
  if (progress.state === "failed" || progress.state === "cancelled") {
    return (
      <p className={cn("flex items-center gap-2 text-[15px] text-destructive", className)}>
        <TriangleAlert aria-hidden className="size-5" /> {progress.label}
      </p>
    );
  }

  // Smooth the bar between updates: advance at the expected pace for up to
  // ~12 seconds after the last real value, capped at 99%.
  const sinceUpdate = Math.min(12, Math.max(0, (now - shownAt) / 1000));
  const pace = progress.expectedTotalSec > 0 ? 100 / progress.expectedTotalSec : 0;
  const percent =
    progress.state === "waiting" ? 0 : Math.min(99, Math.round(progress.percent + sinceUpdate * pace));
  const eta = progress.etaSec === null ? null : Math.max(0, progress.etaSec - sinceUpdate);

  return (
    <div className={cn("flex min-w-0 flex-col gap-1.5", className)} role="status" aria-live="polite">
      <div className="flex items-center justify-between gap-3 text-[15px]">
        <span className="flex min-w-0 items-center gap-2 font-medium">
          <Loader2 aria-hidden className="size-4 shrink-0 animate-spin text-accent motion-reduce:animate-none" />
          <span className="truncate">{progress.label}</span>
        </span>
        {!compact && (
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {progress.state === "waiting" ? formatEta(eta) : `${percent}% · ${formatEta(eta)}`}
          </span>
        )}
      </div>
      <div
        className="h-2 w-full overflow-hidden rounded-full bg-muted"
        role="progressbar"
        aria-label={progress.label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percent}
      >
        <div
          className={cn(
            "h-full rounded-full bg-accent transition-[width] duration-1000 ease-linear motion-reduce:transition-none",
            progress.state === "waiting" && "w-1/4 animate-pulse motion-reduce:animate-none",
          )}
          style={progress.state === "waiting" ? undefined : { width: `${Math.max(2, percent)}%` }}
        />
      </div>
      {compact && <span className="text-sm text-muted-foreground">{formatEta(eta)}</span>}
    </div>
  );
}
