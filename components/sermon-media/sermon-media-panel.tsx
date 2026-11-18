"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Film, Plus, RotateCcw, Sparkles, Square, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { List, ListRow } from "@/components/ui/list-row";
import { SectionHeader } from "@/components/ui/page-header";
import { Skeleton, SkeletonContainer } from "@/components/ui/skeleton";
import { StatusBadge, type StatusTone } from "@/components/ui/status-badge";
import { undoToast } from "@/lib/ui/undo-toast";
import {
  apiRequest,
  recordingApi,
  untrimmedSource,
  type ClipSummary,
  type PublicJob,
  type RecordingOverview,
  type SermonMediaState,
  type Transcript,
} from "@/components/sermon-media/api";
import { SermonMediaPanelSkeleton, PANEL_DESCRIPTION, PANEL_TITLE } from "@/components/sermon-media/sermon-media-panel-skeleton";
import { SermonRangeCard } from "@/components/sermon-media/sermon-range-card";
import { SourcePlayer, type SourcePlayerHandle } from "@/components/sermon-media/source-player";
import { clamp, formatLength, formatTime } from "@/components/sermon-media/time";
import { TranscriptViewer } from "@/components/sermon-media/transcript-viewer";

const POLL_MS = 5000;
const NEW_CLIP_SEC = 45;
const ACTIVE: PublicJob["status"][] = ["queued", "dispatched", "running"];

export const lessonHref = (sermonId: string) => `/dashboard/lesson-builder/${sermonId}`;
export const clipHref = (recordingId: string, clipId: string) =>
  `/dashboard/live-streaming/recordings/${recordingId}/clips/${clipId}`;

function jobStatus(job: PublicJob | null, hasTranscript: boolean): { tone: StatusTone; badge: string; text: string } {
  if (!job) {
    return hasTranscript
      ? { tone: "done", badge: "Ready", text: "The transcript is ready." }
      : {
          tone: "neutral",
          badge: "No transcript yet",
          text: "Make a transcript of this recording to find the sermon, make a lesson and short clips.",
        };
  }
  switch (job.status) {
    case "queued":
    case "dispatched":
      return { tone: "working", badge: "Waiting to start", text: "Waiting to start. This page updates by itself." };
    case "running": {
      const percent = job.progress === null ? null : Math.round(job.progress * 100);
      return {
        tone: "working",
        badge: "Listening",
        text: `Listening to the recording…${percent === null ? "" : ` ${percent}%`}`,
      };
    }
    case "succeeded":
      return { tone: "done", badge: "Ready", text: "The transcript is ready." };
    case "failed":
      return {
        tone: "attention",
        badge: "Couldn't finish",
        text: `Couldn't finish — ${job.error ?? "something went wrong while listening to the recording."}`,
      };
    case "cancelled":
      return { tone: "neutral", badge: "Stopped", text: "The transcript was stopped before it finished." };
  }
}

/**
 * Sermon media on the recording page: transcript status, the sermon's start
 * and end, the transcript itself, a lesson made from the sermon, and short
 * clips for Facebook. Renders nothing when the feature is off for the church.
 */
export function SermonMediaPanel({
  recordingId,
  playback,
  posterUrl,
  title,
  durationSec,
  currentUserId,
  initialSeekSec,
}: {
  recordingId: string;
  playback: { kind: "hls" | "progressive"; url: string } | null;
  posterUrl: string | null;
  title: string;
  /** The untrimmed length, when known. */
  durationSec: number | null;
  currentUserId: string;
  /** `?t=` from a lesson's "check in the recording" link. */
  initialSeekSec: number | null;
}) {
  const router = useRouter();
  const player = useRef<SourcePlayerHandle>(null);
  const [overview, setOverview] = useState<RecordingOverview | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "hidden" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptError, setTranscriptError] = useState<string | null>(null);
  const [clips, setClips] = useState<ClipSummary[] | null>(null);
  const [clipsError, setClipsError] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(initialSeekSec ?? 0);
  const [busy, setBusy] = useState<null | "transcribe" | "stop" | "lesson" | "suggest" | "new-clip">(null);
  const [lessonProblem, setLessonProblem] = useState<string | null>(null);

  const source = untrimmedSource(playback);

  const loadOverview = useCallback(async () => {
    const result = await apiRequest<RecordingOverview>(recordingApi(recordingId), {}, "We couldn't load the sermon transcript.");
    if (result.ok) {
      setOverview(result.data);
      setLoadState("ready");
      setLoadError(null);
    } else if (result.status === 403 || result.status === 401) {
      setLoadState("hidden");
    } else {
      setLoadError(result.error);
      setLoadState((current) => (current === "ready" ? current : "error"));
    }
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
    } else {
      setTranscriptError(result.error);
    }
  }, [recordingId]);

  const loadClips = useCallback(async () => {
    const result = await apiRequest<{ clips: ClipSummary[] }>(`${recordingApi(recordingId)}/clips`, {}, "We couldn't load the clips.");
    if (result.ok) {
      setClips(result.data.clips);
      setClipsError(null);
    } else {
      setClipsError(result.error);
    }
  }, [recordingId]);

  useEffect(() => {
    void loadOverview();
  }, [loadOverview]);

  // Poll while the transcript is being made.
  const jobActive = Boolean(overview?.job && ACTIVE.includes(overview.job.status));
  useEffect(() => {
    if (!jobActive) return;
    const timer = window.setInterval(() => void loadOverview(), POLL_MS);
    return () => window.clearInterval(timer);
  }, [jobActive, loadOverview]);

  const transcriptVersion = overview?.state.currentTranscriptVersion ?? null;
  useEffect(() => {
    if (transcriptVersion === null) return;
    void loadTranscript();
  }, [transcriptVersion, loadTranscript]);

  const confirmedKey = overview?.state.confirmed ? `${overview.state.inputVersion}` : null;
  const clipCount = overview?.clipCount ?? 0;
  useEffect(() => {
    if (loadState !== "ready") return;
    void loadClips();
  }, [loadState, confirmedKey, clipCount, loadClips]);

  // A lesson's "check in the recording" link: scroll here, mark the line, cue the player.
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

  if (loadState === "hidden") return null;
  if (loadState === "loading") return <SermonMediaPanelSkeleton />;
  if (loadState === "error" || !overview) {
    return (
      <section aria-labelledby="sermon-media-heading" className="flex flex-col gap-6">
        <SectionHeader id="sermon-media-heading" title={PANEL_TITLE} description={PANEL_DESCRIPTION} />
        <ErrorState
          compact
          title="The sermon transcript didn't load"
          description={loadError ?? "Nothing was lost. Try again in a moment."}
          onRetry={() => void loadOverview()}
        />
      </section>
    );
  }

  const { state, job, lessons } = overview;
  const hasTranscript = state.currentTranscriptVersion !== null;
  const status = jobStatus(job, hasTranscript);
  const confirmed = state.confirmed;
  const range = confirmed ?? (state.suggestion.startSec !== null && state.suggestion.endSec !== null
    ? { startSec: state.suggestion.startSec, endSec: state.suggestion.endSec }
    : null);

  const startTranscript = async (redo: boolean) => {
    if (redo) {
      const ok = await confirmAction({
        title: "Make the transcript again?",
        description:
          "FaithForm listens to the recording again. Your corrections stay in the history, and lessons and clips made from the current transcript will be marked “Needs review”.",
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
    toast.success("Started the transcript. This page updates by itself while FaithForm listens.");
    setOverview((current) => (current ? { ...current, job: result.data.job } : current));
    void loadOverview();
  };

  const stopTranscript = async () => {
    const ok = await confirmAction({
      title: "Stop the transcript?",
      description: "FaithForm stops listening to this recording. You can start it again later.",
      confirmLabel: "Stop transcript",
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
    toast.success("Stopping the transcript. It may take a moment to finish stopping.");
    void loadOverview();
  };

  const makeLesson = async (replace = false): Promise<void> => {
    setBusy("lesson");
    setLessonProblem(null);
    const result = await apiRequest<{ sermonId: string }>(
      `${recordingApi(recordingId)}/lesson`,
      { method: "POST", body: replace ? { replace: true } : {} },
      "We couldn't make the lesson. Your recording and transcript are safe; please try again.",
    );
    if (result.ok) {
      toast.success("Your lesson is ready. Opening it now.");
      router.push(lessonHref(result.data.sermonId));
      return;
    }
    setBusy(null);
    if (result.status === 409 && result.code === "draft_edited") {
      const ok = await confirmAction({
        title: "Replace your edited lesson?",
        description: "Someone edited the lesson made from this sermon. Making it again replaces those changes.",
        confirmLabel: "Replace lesson",
        destructive: true,
      });
      if (ok) await makeLesson(true);
      return;
    }
    if (result.status === 422 && result.code === "insufficient_source") {
      setLessonProblem(
        `${result.error} Check that the sermon times cover the whole message, or correct any unclear lines in the transcript, then try again.`,
      );
      return;
    }
    if (result.status === 409 && result.code === "range_required") {
      setLessonProblem("Confirm where the sermon starts and ends first, then make the lesson.");
      void loadOverview();
      return;
    }
    setLessonProblem(result.error);
  };

  const suggestClips = async () => {
    setBusy("suggest");
    const result = await apiRequest<{ suggested: number }>(
      `${recordingApi(recordingId)}/clips`,
      { method: "POST", body: { action: "suggest" } },
      "We couldn't suggest clips. Please try again.",
    );
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    const count = result.data.suggested;
    toast.success(
      count > 0
        ? `We found ${count} moment${count === 1 ? "" : "s"} in the sermon that could make good clips.`
        : "We didn't find clear moments for clips. Try making one from the current time.",
    );
    void loadClips();
    void loadOverview();
  };

  const newClipFromCurrentTime = async () => {
    if (!confirmed) return;
    const at = player.current?.currentTime() ?? currentTime;
    const startSec = Math.round(clamp(at, confirmed.startSec, Math.max(confirmed.startSec, confirmed.endSec - NEW_CLIP_SEC)) * 1000) / 1000;
    const endSec = Math.min(confirmed.endSec, startSec + NEW_CLIP_SEC);
    setBusy("new-clip");
    const result = await apiRequest<{ clipId: string }>(
      `${recordingApi(recordingId)}/clips`,
      { method: "POST", body: { action: "create", startSec, endSec } },
      "We couldn't make that clip. Please try again.",
    );
    setBusy(null);
    if (!result.ok) {
      toast.error(result.error);
      return;
    }
    toast.success(`New clip from ${formatTime(startSec)}. Opening it now.`);
    router.push(clipHref(recordingId, result.data.clipId));
  };

  const removeClip = async (clip: ClipSummary) => {
    const patch = (status: "archived" | "draft") =>
      apiRequest<unknown>(`/api/sermon-media/clips/${clip.id}`, {
        method: "PATCH",
        body: { expectedEditVersion: clip.edit_version, status },
      });
    setClips((current) => current?.filter((item) => item.id !== clip.id) ?? current);
    const result = await patch("archived");
    if (!result.ok) {
      toast.error(result.error);
      void loadClips();
      return;
    }
    undoToast(`Removed the clip at ${formatTime(clip.start_sec)}.`, async () => {
      const undo = await patch("draft");
      void loadClips();
      if (!undo.ok) return undo.error;
    }, { undoneMessage: `The clip at ${formatTime(clip.start_sec)} is back.` });
    void loadOverview();
  };

  const lessonDisabledReason = !hasTranscript
    ? "The lesson can be made once the transcript is ready."
    : !confirmed
      ? "Confirm where the sermon starts and ends first."
      : null;

  return (
    <section aria-labelledby="sermon-media-heading" className="flex flex-col gap-6">
      <SectionHeader id="sermon-media-heading" title={PANEL_TITLE} description={PANEL_DESCRIPTION} />

      {/* a. Transcript status */}
      <div className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-card sm:flex-row sm:items-center sm:justify-between dark:shadow-none">
        <div className="flex min-w-0 flex-col gap-2" aria-live="polite">
          <StatusBadge tone={status.tone} className="w-fit">
            {status.badge}
          </StatusBadge>
          <p className="text-[15px]">{status.text}</p>
          {job?.status === "running" && job.progress !== null ? (
            <div
              role="progressbar"
              aria-label="Transcript progress"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(job.progress * 100)}
              className="h-2 w-full max-w-sm overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${Math.round(job.progress * 100)}%` }} />
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap gap-2">
          {job && ACTIVE.includes(job.status) ? (
            <Button type="button" variant="outline" onClick={() => void stopTranscript()} disabled={busy !== null} className="gap-2">
              <Square aria-hidden />
              {busy === "stop" ? "Stopping…" : "Stop"}
            </Button>
          ) : job?.status === "failed" ? (
            <Button type="button" onClick={() => void startTranscript(false)} disabled={busy !== null} className="gap-2">
              <RotateCcw aria-hidden />
              {busy === "transcribe" ? "Starting…" : "Retry"}
            </Button>
          ) : !hasTranscript ? (
            <Button type="button" onClick={() => void startTranscript(false)} disabled={busy !== null} className="gap-2">
              {busy === "transcribe" ? "Starting…" : "Start transcript"}
            </Button>
          ) : null}
        </div>
      </div>

      {/* b + c. Player and sermon times beside the transcript */}
      <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
        <div className="flex min-w-0 flex-col gap-6">
          {source ? (
            <SourcePlayer
              ref={player}
              src={source.url}
              kind={source.kind}
              poster={posterUrl}
              title={`${title} — full recording`}
              onTimeUpdate={setCurrentTime}
            />
          ) : (
            <div className="flex aspect-video items-center justify-center rounded-2xl bg-muted px-6 text-center text-[15px] text-muted-foreground">
              No video to play yet.
            </div>
          )}
          <SermonRangeCard
            recordingId={recordingId}
            state={state}
            transcriptReady={hasTranscript}
            durationSec={transcript?.durationSec ?? durationSec}
            currentUserId={currentUserId}
            dependents={lessons.length + overview.clipCount}
            canEdit
            getCurrentTime={getCurrentTime}
            onSeek={seek}
            onPlayFrom={playFrom}
            onConfirmed={(next: SermonMediaState) => {
              setOverview((current) => (current ? { ...current, state: next } : current));
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

      {/* d. Lesson */}
      <section
        aria-labelledby="sermon-lesson-heading"
        className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-card dark:shadow-none"
      >
        <div className="space-y-1">
          <h3 id="sermon-lesson-heading" className="font-heading text-lg font-semibold">
            Make a lesson from this sermon
          </h3>
          <p className="text-[15px] text-muted-foreground">
            FaithForm writes a small-group lesson from what was preached. You can edit it before you share it.
          </p>
        </div>
        <div className="flex flex-col gap-2">
          <Button
            type="button"
            size="lg"
            className="w-fit gap-2"
            onClick={() => void makeLesson()}
            disabled={Boolean(lessonDisabledReason) || busy !== null}
            aria-describedby={lessonDisabledReason ? "lesson-disabled-reason" : undefined}
          >
            <BookOpen aria-hidden />
            {busy === "lesson" ? "Writing the lesson…" : lessons.length > 0 ? "Make the lesson again" : "Make a lesson"}
          </Button>
          {lessonDisabledReason ? (
            <p id="lesson-disabled-reason" className="text-sm text-muted-foreground">
              {lessonDisabledReason}
            </p>
          ) : busy === "lesson" ? (
            <p className="text-sm text-muted-foreground" aria-live="polite">
              This can take a minute. Please keep this page open.
            </p>
          ) : null}
          {lessonProblem ? (
            <p role="alert" className="rounded-xl bg-destructive/[0.06] px-4 py-3 text-[15px]">
              {lessonProblem}
            </p>
          ) : null}
        </div>
        {lessons.length > 0 ? (
          <List label="Lessons made from this sermon" className="shadow-none">
            {lessons.map((lesson) => (
              <ListRow
                key={lesson.sermonId}
                href={lessonHref(lesson.sermonId)}
                title={lesson.title || "Untitled lesson"}
                subtitle={
                  lesson.needsReview || lesson.stale
                    ? (lesson.reviewReason ?? "The sermon times or transcript changed after this lesson was made.")
                    : lesson.status === "published"
                      ? "Shared"
                      : "Draft"
                }
                status={lesson.needsReview || lesson.stale ? <StatusBadge tone="attention">Needs review</StatusBadge> : null}
              />
            ))}
          </List>
        ) : null}
      </section>

      {/* e. Clips */}
      <section aria-labelledby="sermon-clips-heading" className="flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h3 id="sermon-clips-heading" className="font-heading text-lg font-semibold">
              Short clips for Facebook
            </h3>
            <p className="text-[15px] text-muted-foreground">
              Short moments from the sermon, made into vertical videos you can post as Reels.
            </p>
          </div>
          {confirmed ? (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" onClick={() => void newClipFromCurrentTime()} disabled={busy !== null} className="gap-2">
                <Plus aria-hidden />
                {busy === "new-clip" ? "Making clip…" : "New clip from current time"}
              </Button>
              <Button type="button" variant="outline" onClick={() => void suggestClips()} disabled={busy !== null} className="gap-2">
                <Sparkles aria-hidden />
                {busy === "suggest" ? "Looking for moments…" : "Suggest clips"}
              </Button>
            </div>
          ) : null}
        </div>

        {!confirmed ? (
          <EmptyState
            compact
            icon={Film}
            title="Confirm the sermon times first"
            description="Clips come from inside the sermon, so FaithForm needs to know where it starts and ends."
          />
        ) : clipsError && !clips ? (
          <ErrorState compact title="The clips didn't load" description={clipsError} onRetry={() => void loadClips()} />
        ) : clips === null ? (
          <SkeletonContainer label="clips">
            <Skeleton className="h-[160px] w-full rounded-3xl" />
          </SkeletonContainer>
        ) : clips.length === 0 ? (
          <EmptyState
            compact
            icon={Film}
            title="No clips yet"
            description="Press “Suggest clips” and FaithForm finds strong moments in the sermon, or play the recording and make one from the current time."
          />
        ) : (
          <List label="Clips from this sermon">
            {clips.map((clip) => {
              const length = Number(clip.end_sec) - Number(clip.start_sec);
              return (
                <ListRow
                  key={clip.id}
                  href={clipHref(recordingId, clip.id)}
                  aria-label={`Open the clip at ${formatTime(clip.start_sec)}, ${formatLength(length)}`}
                  title={`${formatTime(clip.start_sec)} · ${formatLength(length)}`}
                  subtitle={
                    <span className="flex flex-col gap-0.5 whitespace-normal">
                      <span className="line-clamp-2 text-foreground/85">“{clip.excerpt}”</span>
                      <span className="truncate text-sm">{clip.needs_review ? (clip.review_reason ?? clip.reason) : clip.reason}</span>
                    </span>
                  }
                  status={
                    clip.needs_review ? (
                      <StatusBadge tone="attention">Needs review</StatusBadge>
                    ) : clip.status === "suggested" ? (
                      <StatusBadge tone="neutral">Suggested</StatusBadge>
                    ) : null
                  }
                  trailing={
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => void removeClip(clip)}
                      aria-label={`Remove the clip at ${formatTime(clip.start_sec)}`}
                      className="gap-1.5"
                    >
                      <Trash2 aria-hidden />
                      Remove
                    </Button>
                  }
                />
              );
            })}
          </List>
        )}
      </section>

      {hasTranscript && !(job && ACTIVE.includes(job.status)) ? (
        <AdvancedSection title="More transcript options">
          <div className="flex flex-col items-start gap-3">
            <p className="text-[15px] text-muted-foreground">
              If the transcript came out badly (for example the sound was poor and has since been fixed), FaithForm can listen to the
              recording again.
            </p>
            <Button type="button" variant="outline" onClick={() => void startTranscript(true)} disabled={busy !== null} className="gap-2">
              <RotateCcw aria-hidden />
              Make the transcript again
            </Button>
          </div>
        </AdvancedSection>
      ) : null}
    </section>
  );
}
