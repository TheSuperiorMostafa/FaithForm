"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, FileVideo, Radio, Sparkles } from "lucide-react";

import { apiRequest } from "@/components/sermon-media/api";
import { JobProgress } from "@/components/sermon-media/job-progress";
import { formatLength } from "@/components/sermon-media/time";
import { Button, buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatServiceDate, type LibraryItem } from "@/components/clips/format";
import { cn } from "@/lib/utils";

const POLL_MS = 5000;

function transcriptStatus(item: LibraryItem): { tone: "ready" | "working" | "attention" | "neutral"; label: string } {
  if (item.transcript === "ready") return { tone: "ready", label: "Transcript ready" };
  if (["queued", "dispatched", "running"].includes(item.transcript)) return { tone: "working", label: "Transcribing" };
  if (item.transcript === "failed" || item.transcript === "cancelled") return { tone: "attention", label: "Transcript didn't finish" };
  if (item.recordingStatus === "processing") return { tone: "working", label: "Recording is processing" };
  return { tone: "neutral", label: "No transcript yet" };
}

/**
 * Make clips: choose a service or uploaded video that has a transcript, and
 * FaithForm finds the best moments, crops them tall, adds captions and makes
 * the videos. Ones without a transcript show where they are instead.
 */
export function MakeClipsDialog({
  open,
  onOpenChange,
  timezone,
  onMade,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  timezone: string;
  onMade: (made: number, title: string) => void;
}) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState<{ message: string; rangeFor: string | null } | null>(null);

  const load = useCallback(async () => {
    const result = await apiRequest<{ items: LibraryItem[] }>("/api/sermon-media/library", {}, "We couldn't load your services and videos.");
    if (result.ok) {
      setItems(result.data.items);
      setLoadError(null);
    } else {
      setLoadError(result.error);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    setProblem(null);
    void load();
  }, [open, load]);

  const transcribing = Boolean(items?.some((item) => ["queued", "dispatched", "running"].includes(item.transcript)));
  useEffect(() => {
    if (!open || !transcribing) return;
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [open, transcribing, load]);

  const chosen = items?.find((item) => item.id === selected && item.transcript === "ready") ?? null;

  const make = async () => {
    if (!chosen || making) return;
    setMaking(true);
    setProblem(null);
    const result = await apiRequest<{ made: number }>(
      `/api/sermon-media/recordings/${chosen.id}/clips`,
      { method: "POST", body: { action: "make" } },
      "We couldn't make clips from that service. Please try again.",
    );
    setMaking(false);
    if (!result.ok) {
      setProblem({ message: result.error, rangeFor: result.code === "range_required" ? chosen.id : null });
      return;
    }
    onMade(result.data.made, chosen.title);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" aria-labelledby="make-clips-title">
        <DialogHeader className="pr-16">
          <DialogTitle id="make-clips-title">Make clips</DialogTitle>
          <DialogDescription className="text-[15px]">
            Choose a service or video. FaithForm finds the best moments in the sermon, crops them for Facebook and adds captions.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-auto overflow-y-auto overscroll-contain px-6 py-5">
          {items === null && loadError ? (
            <ErrorState compact description={loadError} onRetry={() => void load()} />
          ) : items === null ? (
            <SkeletonContainer label="services and videos">
              <ul className="flex flex-col gap-2" aria-hidden>
                {Array.from({ length: 4 }).map((_, index) => (
                  <li key={index} className="flex min-h-[76px] items-center gap-3 rounded-xl border border-border px-4 py-3">
                    <Skeleton className="size-4 rounded-full" />
                    <div className="flex flex-1 flex-col gap-2">
                      <Skeleton className="h-5 w-56 max-w-full" />
                      <Skeleton className="h-4 w-40 max-w-full" />
                    </div>
                  </li>
                ))}
              </ul>
            </SkeletonContainer>
          ) : items.length === 0 ? (
            <EmptyState
              compact
              icon={FileVideo}
              title="No services or videos yet"
              description="After you stream a service or upload a video, it shows here once it has a transcript."
            />
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Service or video</legend>
              {items.map((item) => {
                const status = transcriptStatus(item);
                const selectable = item.transcript === "ready";
                const working = status.tone === "working" && item.job?.progressView;
                const SourceIcon = item.source === "upload" ? FileVideo : Radio;
                return (
                  <label
                    key={item.id}
                    className={cn(
                      "flex min-h-11 items-start gap-3 rounded-xl border border-border px-4 py-3 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring",
                      selectable ? "cursor-pointer" : "cursor-not-allowed bg-muted/40",
                      selected === item.id && selectable && "border-accent bg-accent/[0.06]",
                    )}
                  >
                    <input
                      type="radio"
                      name="make-clips-source"
                      value={item.id}
                      checked={selected === item.id}
                      disabled={!selectable}
                      onChange={() => {
                        setSelected(item.id);
                        setProblem(null);
                      }}
                      className="mt-1.5 size-4 shrink-0 accent-primary"
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-1">
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-[15px] font-semibold">{item.title}</span>
                        <StatusBadge tone={status.tone}>{status.label}</StatusBadge>
                      </span>
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <SourceIcon className="size-4 shrink-0" aria-hidden />
                        {[
                          item.source === "upload" ? "Uploaded video" : "Service",
                          formatServiceDate(item.serviceDate ?? item.createdAt, timezone),
                          item.durationSec ? formatLength(item.durationSec) : null,
                          item.clips.total > 0 ? `${item.clips.total} clip${item.clips.total === 1 ? "" : "s"} made` : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {working ? <JobProgress progress={item.job?.progressView} compact className="mt-1" /> : null}
                      {!selectable && !working && status.tone !== "working" ? (
                        <Link
                          href={`/dashboard/transcripts/${item.id}`}
                          className="inline-flex min-h-11 w-fit items-center text-[15px] font-medium text-primary underline underline-offset-4 dark:text-accent"
                        >
                          Open the transcript page
                        </Link>
                      ) : null}
                    </span>
                  </label>
                );
              })}
            </fieldset>
          )}
        </div>

        {problem ? (
          <div role="alert" className="mx-6 mb-1 flex shrink-0 flex-col gap-3 rounded-xl bg-orange-50 px-4 py-3 text-[15px] text-orange-900 dark:bg-orange-500/10 dark:text-orange-100">
            <span className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
              {problem.message}
            </span>
            {problem.rangeFor ? (
              <Link href={`/dashboard/transcripts/${problem.rangeFor}`} className={cn(buttonVariants({ variant: "outline" }), "w-fit")}>
                Choose the sermon on the transcript
              </Link>
            ) : null}
          </div>
        ) : null}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" size="lg" onClick={() => void make()} disabled={!chosen || making}>
            <Sparkles aria-hidden />
            {making ? "Making clips…" : "Make clips"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
