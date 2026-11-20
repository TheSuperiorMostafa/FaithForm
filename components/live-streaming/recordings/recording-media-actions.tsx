"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowRight, Captions, Clapperboard } from "lucide-react";
import { toast } from "sonner";

import { JobProgress } from "@/components/sermon-media/job-progress";
import { apiRequest, isJobActive, recordingApi, type PublicJob, type RecordingOverview } from "@/components/sermon-media/api";
import { transcriptStatus } from "@/components/transcripts/status";
import { Button, buttonVariants } from "@/components/ui/button";
import { StatusBadge } from "@/components/ui/status-badge";
import { CLIPS_HREF, transcriptHref } from "@/lib/sermon-media/hrefs";
import { cn } from "@/lib/utils";

const POLL_MS = 5000;

type Busy = null | "transcript" | "clips";

/**
 * The recording page's Transcript and Clips, inside its More options. Each is
 * one labelled button. Making clips needs nothing first: without a transcript,
 * FaithForm writes one out on the way and then makes the clips by itself.
 * Renders nothing when the person can't use Transcripts & Clips.
 */
export function RecordingMediaActions({ recordingId, recordingStatus }: { recordingId: string; recordingStatus: string }) {
  const [overview, setOverview] = useState<RecordingOverview | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "hidden" | "error">("loading");
  const [busy, setBusy] = useState<Busy>(null);
  const [clipsNote, setClipsNote] = useState<{ tone: "done" | "problem"; text: string } | null>(null);

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

  const job = overview?.job ?? null;
  const active = isJobActive(job);
  useEffect(() => {
    if (!active) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void load();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [active, load]);

  if (loadState === "hidden") return null;

  const hasTranscript = overview?.state.currentTranscriptVersion !== null && overview?.state.currentTranscriptVersion !== undefined;
  const kind = overview ? transcriptStatus({ recordingStatus, transcriptReady: hasTranscript, job }) : null;
  const clipCount = overview?.clipCount ?? 0;
  const clipsQueued = Boolean(overview?.clipsQueued);

  const makeTranscript = async () => {
    setBusy("transcript");
    const result = await apiRequest<{ job: PublicJob }>(
      `${recordingApi(recordingId)}/transcribe`,
      { method: "POST", body: {} },
      "We couldn't start the transcript. Please try again.",
    );
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Writing out the service now. You can leave this page; FaithForm keeps going.");
    void load();
  };

  const makeClips = async () => {
    setBusy("clips");
    setClipsNote(null);
    const result = await apiRequest<{ made: number; transcribing?: boolean }>(
      `${recordingApi(recordingId)}/clips`,
      { method: "POST", body: { action: "make" } },
      "We couldn't make clips. Please try again.",
    );
    setBusy(null);
    if (!result.ok) {
      setClipsNote({ tone: "problem", text: result.error });
      return;
    }
    if (result.data.transcribing) {
      setClipsNote({
        tone: "done",
        text: "Making clips. FaithForm writes out the service first, then the clips wait in Clips for your approval, usually in a few minutes.",
      });
    } else if (result.data.made > 0) {
      const made = result.data.made;
      const text = `${made} clip${made === 1 ? " is" : "s are"} being made. They wait in Clips for your approval.`;
      toast.success(text);
      setClipsNote({ tone: "done", text });
    } else {
      setClipsNote({
        tone: "problem",
        text: clipCount > 0 ? "No new moments found. This recording's clips are already in Clips." : "We didn't find clear moments for clips in this recording.",
      });
    }
    void load();
  };

  const transcriptLine =
    loadState === "error"
      ? { tone: "neutral" as const, label: "Couldn't check" }
      : kind === "ready"
        ? { tone: "done" as const, label: "Ready" }
        : kind === "working"
          ? null
          : kind === "failed"
            ? { tone: "attention" as const, label: "Couldn't finish" }
            : kind === "stopped"
              ? { tone: "neutral" as const, label: "Stopped" }
              : kind === "preparing"
                ? { tone: "working" as const, label: "Video is processing" }
                : kind === "video_problem"
                  ? { tone: "attention" as const, label: "Video couldn't be prepared" }
                  : { tone: "neutral" as const, label: "Not made yet" };

  return (
    <section aria-labelledby={`media-${recordingId}`} className="flex flex-col gap-5 border-t border-border pt-5">
      <h4 id={`media-${recordingId}`} className="text-[15px] font-semibold">
        Transcript and clips
      </h4>

      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Captions className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <span className="text-[15px] font-medium">Transcript</span>
            {loadState === "loading" ? (
              <span className="text-sm text-muted-foreground">Checking…</span>
            ) : transcriptLine ? (
              <StatusBadge tone={transcriptLine.tone} className="w-fit">
                {transcriptLine.label}
              </StatusBadge>
            ) : job?.progressView ? (
              <JobProgress progress={job.progressView} compact />
            ) : (
              <StatusBadge tone="working" className="w-fit">
                Transcribing
              </StatusBadge>
            )}
          </div>
        </div>
        {kind === "ready" || kind === "working" || loadState === "error" ? (
          <Link href={transcriptHref(recordingId)} className={cn(buttonVariants({ variant: "outline" }), "w-full")}>
            Open transcript
            <ArrowRight aria-hidden />
          </Link>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="w-full"
            onClick={() => void makeTranscript()}
            disabled={busy !== null || loadState === "loading" || kind === "preparing" || kind === "video_problem"}
          >
            <Captions aria-hidden />
            {busy === "transcript" ? "Starting…" : kind === "failed" || kind === "stopped" ? "Try the transcript again" : "Make transcript"}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div className="flex items-start gap-3">
          <Clapperboard className="mt-0.5 size-5 shrink-0 text-accent" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <span className="text-[15px] font-medium">Clips for Facebook</span>
            <span className="text-sm text-muted-foreground">
              {clipsQueued
                ? "Clips will be made as soon as the transcript is ready."
                : clipCount > 0
                  ? `${clipCount} clip${clipCount === 1 ? "" : "s"} made from this recording.`
                  : "FaithForm picks strong moments and makes short captioned videos. Nothing posts until you approve it."}
            </span>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          className="w-full"
          onClick={() => void makeClips()}
          disabled={busy !== null || loadState === "loading" || clipsQueued || kind === "preparing" || kind === "video_problem"}
        >
          <Clapperboard aria-hidden />
          {busy === "clips" ? "Starting…" : clipCount > 0 ? "Make more clips" : "Make clips"}
        </Button>
        {clipsNote ? (
          <p
            role={clipsNote.tone === "problem" ? "alert" : "status"}
            className={cn(
              "rounded-xl px-4 py-3 text-[15px]",
              clipsNote.tone === "problem" ? "bg-destructive/[0.06]" : "bg-emerald-500/[0.08]",
            )}
          >
            {clipsNote.text}
          </p>
        ) : null}
        {clipCount > 0 || clipsNote?.tone === "done" || clipsQueued ? (
          <Link
            href={CLIPS_HREF}
            className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-semibold text-primary underline-offset-4 hover:underline dark:text-accent"
          >
            Review clips
            <ArrowRight className="size-4" aria-hidden />
          </Link>
        ) : null}
      </div>
    </section>
  );
}
