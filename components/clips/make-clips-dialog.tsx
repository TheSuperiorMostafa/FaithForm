"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertTriangle, FileVideo, Radio, Sparkles } from "lucide-react";

import { apiRequest } from "@/components/sermon-media/api";
import { JobProgress } from "@/components/sermon-media/job-progress";
import { formatLength } from "@/components/sermon-media/time";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/ui/status-badge";
import { formatServiceDate, type LibraryItem } from "@/components/clips/format";
import { recordingPageHref } from "@/lib/sermon-media/hrefs";
import { cn } from "@/lib/utils";

const POLL_MS = 5000;

/** Any finished recording can make clips; a transcript is made on the way if needed. */
export function canMakeClipsFrom(item: Pick<LibraryItem, "recordingStatus">): boolean {
  return item.recordingStatus === "ready" || item.recordingStatus === "published";
}

function sourceStatus(item: LibraryItem): { tone: "ready" | "working" | "attention" | "neutral"; label: string } | null {
  if (item.recordingStatus === "processing") return { tone: "working", label: "Video is processing" };
  if (item.recordingStatus === "failed") return { tone: "attention", label: "Video couldn't be prepared" };
  if (["queued", "dispatched", "running"].includes(item.transcript)) return { tone: "working", label: "Transcribing" };
  if (item.clips.total > 0) return { tone: "ready", label: `${item.clips.total} clip${item.clips.total === 1 ? "" : "s"} made` };
  return null;
}

/**
 * Make clips: choose a service or uploaded video, and FaithForm finds the best
 * moments, crops them tall, adds captions and makes the videos. A video with
 * no transcript yet is transcribed first, automatically.
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
  onMade: (made: number, title: string, transcribing: boolean) => void;
}) {
  const [items, setItems] = useState<LibraryItem[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [making, setMaking] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

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

  const chosen = items?.find((item) => item.id === selected && canMakeClipsFrom(item)) ?? null;

  const make = async () => {
    if (!chosen || making) return;
    setMaking(true);
    setProblem(null);
    const result = await apiRequest<{ made: number; transcribing?: boolean }>(
      `/api/sermon-media/recordings/${chosen.id}/clips`,
      { method: "POST", body: { action: "make" } },
      "We couldn't make clips from that service. Please try again.",
    );
    setMaking(false);
    if (!result.ok) {
      setProblem(result.error);
      return;
    }
    onMade(result.data.made, chosen.title, Boolean(result.data.transcribing));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl" aria-labelledby="make-clips-title">
        <DialogHeader className="pr-16">
          <DialogTitle id="make-clips-title">Make clips</DialogTitle>
          <DialogDescription className="text-[15px]">
            Choose a service or video. FaithForm finds the best moments in the sermon, crops them for Facebook and adds captions. No transcript needed.
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
              description="After you stream a service or upload a video, it shows here once it has finished processing."
            />
          ) : (
            <fieldset className="flex flex-col gap-2">
              <legend className="sr-only">Service or video</legend>
              {items.map((item) => {
                const status = sourceStatus(item);
                const selectable = canMakeClipsFrom(item);
                const working = status?.tone === "working" && item.job?.progressView;
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
                        {status ? <StatusBadge tone={status.tone}>{status.label}</StatusBadge> : null}
                      </span>
                      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
                        <SourceIcon className="size-4 shrink-0" aria-hidden />
                        {[
                          item.source === "upload" ? "Uploaded video" : "Service",
                          formatServiceDate(item.serviceDate ?? item.createdAt, timezone),
                          item.durationSec ? formatLength(item.durationSec) : null,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </span>
                      {working ? <JobProgress progress={item.job?.progressView} compact className="mt-1" /> : null}
                      {item.recordingStatus === "failed" ? (
                        <Link
                          href={recordingPageHref(item.id)}
                          className="inline-flex min-h-11 w-fit items-center text-[15px] font-medium text-primary underline underline-offset-4 dark:text-accent"
                        >
                          Open the recording
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
          <div role="alert" className="mx-6 mb-1 flex shrink-0 items-start gap-2 rounded-xl bg-orange-50 px-4 py-3 text-[15px] text-orange-900 dark:bg-orange-500/10 dark:text-orange-100">
            <AlertTriangle className="mt-0.5 size-5 shrink-0" aria-hidden />
            {problem}
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
