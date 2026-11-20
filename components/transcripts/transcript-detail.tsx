"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Captions, Download, RotateCcw, Square, TriangleAlert, Video } from "lucide-react";
import { toast } from "sonner";

import { JobProgress } from "@/components/sermon-media/job-progress";
import {
  apiRequest,
  isJobActive,
  recordingApi,
  type PublicJob,
  type RecordingOverview,
  type SermonMediaState,
  type Transcript,
} from "@/components/sermon-media/api";
import { SermonRangeCard } from "@/components/sermon-media/sermon-range-card";
import { SourcePlayer, type SourcePlayerHandle } from "@/components/sermon-media/source-player";
import { formatLength } from "@/components/sermon-media/time";
import { TranscriptViewer } from "@/components/sermon-media/transcript-viewer";
import { downloadText, transcriptFilename, transcriptToText } from "@/components/transcripts/export";
import { transcriptStatus, type TranscriptStatusKind } from "@/components/transcripts/status";
import { BACK_LABEL } from "@/components/transcripts/transcript-detail-skeleton";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { PageHeader } from "@/components/ui/page-header";
import { StatusBadge } from "@/components/ui/status-badge";
import { recordingPageHref } from "@/lib/sermon-media/hrefs";
import { cn } from "@/lib/utils";

const POLL_MS = 5000;

export type TranscriptRecording = {
  id: string;
  title: string;
  /** "Sunday, November 15, 2026", in the church's time zone. */
  dateLabel: string;
  source: "livestream" | "upload";
  status: string;
  /** Untrimmed length, when known. */
  durationSec: number | null;
  posterUrl: string | null;
};

type Busy = null | "transcribe" | "stop";

/**
 * One recording's transcript, under Live > Recordings: live progress while
 * FaithForm listens, the full recording, the sermon times FaithForm found
 * (used as they are; staff can move them), and the transcript itself with
 * search, click-to-seek and corrections. Lessons and clips are made elsewhere
 * (Lessons, and the recording's More options). Checks back every five seconds
 * only while work is running.
 */
export function TranscriptDetail({
  recording,
  source,
  initialState,
  initialJob,
  currentUserId,
  initialSeekSec,
  autoTranscribe,
}: {
  recording: TranscriptRecording;
  source: { kind: "hls" | "progressive"; url: string } | null;
  initialState: SermonMediaState;
  initialJob: PublicJob | null;
  currentUserId: string;
  /** `?t=` from a lesson's "check in the recording" link. */
  initialSeekSec: number | null;
  autoTranscribe: boolean;
}) {
  const player = useRef<SourcePlayerHandle>(null);
  const [state, setState] = useState(initialState);
  const [job, setJob] = useState(initialJob);
  /** Lessons and clips made from the current sermon times (changing them flags these). */
  const [dependents, setDependents] = useState(0);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(initialState.currentTranscriptVersion !== null);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(initialSeekSec ?? 0);
  const [busy, setBusy] = useState<Busy>(null);
  const recordingId = recording.id;

  const loadOverview = useCallback(async () => {
    const result = await apiRequest<RecordingOverview>(recordingApi(recordingId), {}, "We couldn't check on the transcript.");
    if (!result.ok) return result.error;
    setState(result.data.state);
    setJob(result.data.job);
    setDependents(result.data.lessons.length + result.data.clipCount);
    return null;
  }, [recordingId]);

  const loadTranscript = useCallback(async () => {
    setTranscriptLoading(true);
    const result = await apiRequest<{ transcript: Transcript }>(
      `${recordingApi(recordingId)}/transcript`,
      {},
      "We couldn't load the transcript.",
    );
    setTranscriptLoading(false);
    if (result.ok) {
      setTranscript(result.data.transcript);
      setTranscriptError(null);
    } else if (result.status === 404) {
      setTranscript(null);
      setTranscriptError(null);
    } else {
      setTranscriptError(result.error);
    }
  }, [recordingId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  // Check back while FaithForm is working, or while the video is still being prepared.
  const active = isJobActive(job);
  const watching = active || recording.status === "processing";
  useEffect(() => {
    if (!watching) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void loadOverview();
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [watching, loadOverview]);

  // Say so when the transcript finishes while the page is open.
  const wasActive = useRef(active);
  useEffect(() => {
    if (wasActive.current && !active && job?.status === "succeeded") {
      toast.success("The transcript is ready.");
    }
    wasActive.current = active;
  }, [active, job?.status]);

  const transcriptVersion = state.currentTranscriptVersion;
  useEffect(() => {
    if (transcriptVersion === null) return;
    void loadTranscript();
  }, [transcriptVersion, loadTranscript]);

  // A lesson's "check in the recording" link: show that line and cue the player.
  const deepLinked = useRef(false);
  useEffect(() => {
    if (deepLinked.current || initialSeekSec === null || !transcript) return;
    deepLinked.current = true;
    player.current?.seek(initialSeekSec);
    window.requestAnimationFrame(() => {
      document.getElementById("transcript")?.scrollIntoView({ block: "start" });
    });
  }, [initialSeekSec, transcript]);

  const seek = useCallback((seconds: number) => {
    player.current?.seek(seconds);
    setCurrentTime(seconds);
  }, []);
  const playFrom = useCallback((from: number, until?: number) => {
    player.current?.playFrom(from, until);
    setCurrentTime(from);
  }, []);
  const getCurrentTime = useCallback(() => player.current?.currentTime() ?? currentTime, [currentTime]);

  const hasTranscript = state.currentTranscriptVersion !== null;
  const kind = transcriptStatus({ recordingStatus: recording.status, transcriptReady: hasTranscript, job });
  const confirmed = state.confirmed;
  const range =
    confirmed ??
    (state.suggestion.startSec !== null && state.suggestion.endSec !== null
      ? { startSec: state.suggestion.startSec, endSec: state.suggestion.endSec }
      : null);

  const startTranscript = async (redo: boolean) => {
    if (redo) {
      const ok = await confirmAction({
        title: "Make the transcript again?",
        description:
          "FaithForm listens to the whole service again. Your corrections stay in the history, and lessons and clips made from the current transcript will be marked “Needs review”.",
        confirmLabel: "Make transcript again",
      });
      if (!ok) return;
    }
    setBusy("transcribe");
    const result = await apiRequest<{ job: PublicJob }>(
      `${recordingApi(recordingId)}/transcribe`,
      { method: "POST", body: redo ? { redo: true } : {} },
      "We couldn't start the transcript. Please try again.",
    );
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Transcribing now. You can leave this page; FaithForm keeps going.");
    setJob(result.data.job);
    void loadOverview();
  };

  const stopTranscript = async () => {
    const ok = await confirmAction({
      title: "Stop transcribing?",
      description: "FaithForm stops listening to this service. You can start again later.",
      confirmLabel: "Stop transcribing",
    });
    if (!ok) return;
    setBusy("stop");
    const result = await apiRequest<{ job: PublicJob | null }>(
      `${recordingApi(recordingId)}/transcribe`,
      { method: "DELETE" },
      "We couldn't stop the transcript. Please try again.",
    );
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success("Stopping. It can take a few seconds to finish stopping.");
    void loadOverview();
  };

  const download = () => {
    if (!transcript) return;
    const text = transcriptToText({
      title: recording.title,
      dateLabel: recording.dateLabel,
      segments: transcript.segments,
      sermon: confirmed,
    });
    downloadText(transcriptFilename(recording.title), text);
  };

  const length = recording.durationSec ?? transcript?.durationSec ?? null;

  return (
    <div className="flex w-full flex-col gap-8">
      <Link
        href={recordingPageHref(recordingId)}
        className="inline-flex min-h-11 w-fit items-center gap-2 text-[15px] font-medium text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" aria-hidden />
        {BACK_LABEL}
      </Link>

      {/* The Live layout owns the page's h1. */}
      <PageHeader
        as="h2"
        title={`Transcript: ${recording.title}`}
        description={
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{recording.dateLabel}</span>
            {length ? (
              <>
                <span aria-hidden>·</span>
                <span>{formatLength(length)}</span>
              </>
            ) : null}
            <span aria-hidden>·</span>
            <span>{recording.source === "upload" ? "Uploaded video" : "Livestream"}</span>
          </span>
        }
        secondary={
          <Button variant="outline" onClick={download} disabled={!transcript} aria-describedby={transcript ? undefined : "download-hint"}>
            <Download aria-hidden />
            Download transcript
            {transcript ? null : (
              <span id="download-hint" className="sr-only">
                Available once the transcript is ready.
              </span>
            )}
          </Button>
        }
      />

      <StatusBanner
        kind={kind}
        job={job}
        busy={busy}
        autoTranscribe={autoTranscribe}
        recordingId={recordingId}
        onStart={() => void startTranscript(false)}
        onStop={() => void stopTranscript()}
      />

      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {source ? (
            <SourcePlayer
              ref={player}
              src={source.url}
              kind={source.kind}
              poster={recording.posterUrl}
              title={`${recording.title} — full recording`}
              onTimeUpdate={setCurrentTime}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-2xl bg-muted px-6 text-center text-[15px] text-muted-foreground">
              {recording.status === "processing" ? "The video shows here once it's ready." : "No video to play."}
            </div>
          )}
          <SermonRangeCard
              recordingId={recordingId}
              state={state}
              transcriptReady={hasTranscript}
              durationSec={transcript?.durationSec ?? recording.durationSec}
              currentUserId={currentUserId}
              dependents={dependents}
              canEdit
              getCurrentTime={getCurrentTime}
              onSeek={seek}
              onPlayFrom={playFrom}
              onConfirmed={(next) => {
                setState(next);
                void loadOverview();
              }}
              onReload={() => void loadOverview()}
            />
        </div>

        <TranscriptViewer
          recordingId={recordingId}
          transcript={transcript}
          loading={transcriptLoading || (hasTranscript && !transcript && !transcriptError)}
          error={transcriptError}
          onRetryLoad={() => void loadTranscript()}
          range={range}
          currentTime={currentTime}
          focusSec={initialSeekSec}
          onSeek={seek}
          canEdit
          onSaved={() => {
            void loadTranscript();
            void loadOverview();
          }}
        />
      </div>

      {hasTranscript && !active ? (
        <AdvancedSection title="More transcript options">
          <div className="flex flex-col items-start gap-3">
            <p className="text-[15px] text-muted-foreground">
              If the transcript came out badly (for example the sound was poor and has since been fixed), FaithForm can listen to the
              whole service again.
            </p>
            <Button variant="outline" onClick={() => void startTranscript(true)} disabled={busy !== null}>
              <RotateCcw aria-hidden />
              Make the transcript again
            </Button>
          </div>
        </AdvancedSection>
      ) : null}
    </div>
  );
}

/** The big "where is it up to" card. Hidden once the transcript is ready. */
function StatusBanner({
  kind,
  job,
  busy,
  autoTranscribe,
  recordingId,
  onStart,
  onStop,
}: {
  kind: TranscriptStatusKind;
  job: PublicJob | null;
  busy: Busy;
  autoTranscribe: boolean;
  recordingId: string;
  onStart: () => void;
  onStop: () => void;
}) {
  if (kind === "ready") return null;

  const shell = "flex flex-col gap-5 rounded-2xl border p-6 shadow-card sm:flex-row sm:items-center sm:justify-between dark:shadow-none";

  if (kind === "working") {
    return (
      <section aria-labelledby="transcript-progress-heading" className={cn(shell, "border-accent/30 bg-gradient-to-br from-accent/10 via-card to-card")}>
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="space-y-1">
            <h2 id="transcript-progress-heading" className="font-heading text-xl font-bold">
              Transcribing this service
            </h2>
            <p className="text-[15px] text-muted-foreground">
              You can leave this page. FaithForm keeps going, and this page updates by itself.
            </p>
          </div>
          {job?.progressView ? (
            <JobProgress progress={job.progressView} className="max-w-xl" />
          ) : (
            <StatusBadge tone="working" className="w-fit">
              Transcribing
            </StatusBadge>
          )}
        </div>
        <Button variant="outline" onClick={onStop} disabled={busy !== null} className="shrink-0">
          <Square aria-hidden />
          {busy === "stop" ? "Stopping…" : "Stop"}
        </Button>
      </section>
    );
  }

  if (kind === "preparing") {
    return (
      <section className={cn(shell, "border-border bg-card")}>
        <div className="flex min-w-0 items-start gap-4">
          <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-amber-500/10 text-amber-700 dark:text-amber-300">
            <Video className="size-5" />
          </span>
          <div className="space-y-1">
            <h2 className="font-heading text-xl font-bold">Getting the video ready</h2>
            <p className="text-[15px] text-muted-foreground" aria-live="polite">
              {autoTranscribe
                ? "FaithForm starts transcribing by itself as soon as the video is ready. This page updates by itself."
                : "Once the video is ready you can transcribe it here. This page updates by itself."}
            </p>
          </div>
        </div>
      </section>
    );
  }

  if (kind === "video_problem") {
    return (
      <section role="alert" className={cn(shell, "border-orange-300/50 bg-orange-500/[0.04]")}>
        <div className="flex min-w-0 items-start gap-4">
          <span aria-hidden className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-orange-500/10 text-orange-700 dark:text-orange-300">
            <TriangleAlert className="size-5" />
          </span>
          <div className="space-y-1">
            <h2 className="font-heading text-xl font-bold">This video couldn&apos;t be prepared</h2>
            <p className="text-[15px] text-muted-foreground">
              FaithForm can only transcribe a video that plays. Open the recording to see what happened.
            </p>
          </div>
        </div>
        <Link
          href={recordingPageHref(recordingId)}
          className="inline-flex min-h-11 shrink-0 items-center justify-center gap-2 rounded-[10px] border border-primary/45 px-6 text-[15px] font-semibold text-primary hover:bg-accent/10 dark:border-accent/60 dark:text-accent"
        >
          Open the recording
        </Link>
      </section>
    );
  }

  const failed = kind === "failed";
  return (
    <section
      role={failed ? "alert" : undefined}
      className={cn(shell, failed ? "border-orange-300/50 bg-orange-500/[0.04]" : "border-accent/30 bg-gradient-to-br from-accent/10 via-card to-card")}
    >
      <div className="flex min-w-0 items-start gap-4">
        <span
          aria-hidden
          className={cn(
            "flex size-11 shrink-0 items-center justify-center rounded-xl",
            failed ? "bg-orange-500/10 text-orange-700 dark:text-orange-300" : "bg-accent/15 text-primary dark:text-accent",
          )}
        >
          {failed ? <TriangleAlert className="size-5" /> : <Captions className="size-5" />}
        </span>
        <div className="space-y-1">
          <h2 className="font-heading text-xl font-bold">
            {failed
              ? "We couldn't finish the transcript"
              : kind === "stopped"
                ? "Transcribing was stopped"
                : "This service hasn't been transcribed yet"}
          </h2>
          <p className="text-[15px] text-muted-foreground">
            {failed
              ? `${job?.error ?? "Something went wrong while listening to the service."} Nothing was lost — try again.`
              : "FaithForm writes out every word and finds the sermon. It usually takes a few minutes."}
          </p>
        </div>
      </div>
      <Button size="lg" onClick={onStart} disabled={busy !== null} className="shrink-0">
        {failed ? <RotateCcw aria-hidden /> : <Captions aria-hidden />}
        {busy === "transcribe" ? "Starting…" : failed ? "Try again" : "Transcribe"}
      </Button>
    </section>
  );
}
