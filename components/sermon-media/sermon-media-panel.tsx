"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Captions } from "lucide-react";

import { JobProgress } from "@/components/sermon-media/job-progress";
import { apiRequest, isJobActive, recordingApi, type RecordingOverview } from "@/components/sermon-media/api";
import {
  PANEL_CARD,
  PANEL_DESCRIPTION,
  PANEL_TITLE,
  SermonMediaPanelSkeleton,
} from "@/components/sermon-media/sermon-media-panel-skeleton";
import { formatTime } from "@/components/sermon-media/time";
import { transcriptStatus } from "@/components/transcripts/status";
import { buttonVariants } from "@/components/ui/button";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";

const POLL_MS = 5000;

/**
 * The recording page's pointer to its transcript. All the work (sermon times,
 * corrections, lesson, clips) happens in Transcripts, so this card only says
 * where the transcript is up to and opens it. Renders nothing when the
 * feature is off for the person.
 */
export function SermonMediaPanel({ recordingId, recordingStatus = "ready" }: { recordingId: string; recordingStatus?: string }) {
  const [overview, setOverview] = useState<RecordingOverview | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "hidden" | "error">("loading");

  const load = useCallback(async () => {
    const result = await apiRequest<RecordingOverview>(recordingApi(recordingId), {}, "We couldn't check on the transcript.");
    if (result.ok) {
      setOverview(result.data);
      setLoadState("ready");
    } else if (result.status === 401 || result.status === 403) {
      setLoadState("hidden");
    } else {
      setLoadState((current) => (current === "ready" ? current : "error"));
    }
  }, [recordingId]);

  useEffect(() => {
    void load();
  }, [load]);

  const active = isJobActive(overview?.job);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, load]);

  if (loadState === "hidden") return null;
  if (loadState === "loading") return <SermonMediaPanelSkeleton />;

  const href = `/dashboard/transcripts/${recordingId}`;
  const job = overview?.job ?? null;
  const confirmed = overview?.state.confirmed ?? null;
  const kind = overview
    ? transcriptStatus({ recordingStatus, transcriptReady: overview.state.currentTranscriptVersion !== null, job })
    : null;

  const summary: { tone: StatusTone; badge: string; text: string } | null =
    loadState === "error" || !kind
      ? { tone: "neutral", badge: "Couldn't check", text: "Open the transcript to see where it's up to." }
      : kind === "ready"
        ? {
            tone: "done",
            badge: "Ready",
            text: confirmed
              ? `Sermon ${formatTime(confirmed.startSec)}–${formatTime(confirmed.endSec)}${confirmed.automatic ? ", found automatically" : ""}. ${PANEL_DESCRIPTION}`
              : PANEL_DESCRIPTION,
          }
        : kind === "failed"
          ? { tone: "attention", badge: "Couldn't finish", text: "Nothing was lost. Open the transcript to try again." }
          : kind === "working"
            ? null
            : { tone: "neutral", badge: kind === "stopped" ? "Stopped" : "Not transcribed", text: "Open the transcript to start it." };

  return (
    <section aria-labelledby="sermon-media-heading" className={PANEL_CARD}>
      <div className="flex min-w-0 flex-1 items-start gap-4">
        <span
          aria-hidden
          className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
        >
          <Captions className="size-5" />
        </span>
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <h2 id="sermon-media-heading" className="font-heading text-lg font-semibold">
            {PANEL_TITLE}
          </h2>
          <div className="flex min-h-14 flex-col justify-center gap-1.5">
            {summary === null ? (
              job?.progressView ? (
                <JobProgress progress={job.progressView} className="max-w-md" />
              ) : (
                <StatusBadge tone="working" className="w-fit">
                  Transcribing
                </StatusBadge>
              )
            ) : (
              <>
                <StatusBadge tone={summary.tone} className="w-fit">
                  {summary.badge}
                </StatusBadge>
                <p className="text-[15px] text-muted-foreground">{summary.text}</p>
              </>
            )}
          </div>
        </div>
      </div>
      <Link href={href} className={buttonVariants({ variant: kind === "ready" ? "default" : "outline", className: "shrink-0" })}>
        Open transcript
        <ArrowRight aria-hidden />
      </Link>
    </section>
  );
}
