"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, BookOpen, FileDown, Loader2, PlayCircle, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { StatusBadge } from "@/components/ui/status-badge";
import type { LessonRecordingSource } from "@/lib/sermon-media/lesson-source";
import { formatTimestamp } from "@/lib/sermon-media/transcript";
import type { DiscussionQuestion, SermonOutline } from "@/types/sermon";

type CreateLessonPanelProps = {
  sermonId: string;
  sermonTitle: string;
  scriptureRefs: string[];
  outline: SermonOutline | null;
  questions: DiscussionQuestion[];
  /**
   * Set when the lesson was made from a recorded sermon: shows where each part
   * came from, references to check, and "Make a new lesson" rebuilds it from
   * the recording instead of the passages.
   */
  recordingSource?: LessonRecordingSource | null;
};

const CATEGORY_LABEL: Record<DiscussionQuestion["category"], string> = {
  warmup: "Warm-up",
  observation: "Observation",
  interpretation: "Interpretation",
  application: "Application",
};

const LESSON_FAILED =
  "We couldn't make the lesson just now. Nothing was changed. Please try again in a minute.";

/** Up to `limit` distinct start times (in seconds) for these transcript segments. */
function evidenceTimes(
  source: LessonRecordingSource,
  ids: string[] | undefined,
  limit = 2,
): number[] {
  const times: number[] = [];
  for (const id of ids ?? []) {
    const segment = source.evidence.segments?.[id];
    if (!segment) continue;
    const sec = Math.max(0, Math.floor(segment.start));
    if (!times.includes(sec)) times.push(sec);
    if (times.length >= limit) break;
  }
  return times;
}

function recordingHref(recordingId: string, sec: number): string {
  return `/dashboard/transcripts/${recordingId}?t=${sec}#transcript`;
}

/** "Check in the recording: 31:04 · 33:10", or nothing when there is no evidence. */
function SourceLinks({
  source,
  ids,
  compact = false,
}: {
  source: LessonRecordingSource | null | undefined;
  ids: string[] | undefined;
  compact?: boolean;
}) {
  if (!source) return null;
  const times = evidenceTimes(source, ids, compact ? 1 : 2);
  if (times.length === 0) return null;
  return (
    <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted-foreground">
      {!compact && <span>Check in the recording:</span>}
      {times.map((sec) => (
        <Link
          key={sec}
          href={recordingHref(source.recordingId, sec)}
          className="inline-flex min-h-11 items-center gap-1 font-medium text-primary underline underline-offset-4 hover:text-accent sm:min-h-0"
          aria-label={`Check in the recording at ${formatTimestamp(sec)}`}
        >
          <PlayCircle aria-hidden className="size-4" />
          {formatTimestamp(sec)}
        </Link>
      ))}
    </p>
  );
}

export function CreateLessonPanel({
  sermonId,
  sermonTitle,
  scriptureRefs,
  outline,
  questions,
  recordingSource = null,
}: CreateLessonPanelProps) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const hasLesson = Boolean(outline);

  async function generateLesson() {
    if (hasLesson) {
      const ok = await confirmAction({
        title: "Make a new lesson?",
        description:
          "This replaces the current outline and discussion questions with new ones. The slides aren't changed.",
        confirmLabel: "Replace the lesson",
        destructive: true,
      });
      if (!ok) return;
    }
    setGenerating(true);
    setError(null);
    if (recordingSource) {
      await generateFromRecording(recordingSource, hasLesson);
      return;
    }
    try {
      // Outline and discussion questions come from one model call — a second
      // sequential request roughly doubled how long the pastor waited here.
      const res = await fetch("/api/sermon/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sermonId,
          topic: sermonTitle,
          scripture_refs: scriptureRefs,
          keep_title: true,
          include_questions: true,
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: unknown } | null;
        setError(typeof data?.error === "string" ? data.error : LESSON_FAILED);
        return;
      }

      toast.success(hasLesson ? `New lesson ready for "${sermonTitle}".` : `Lesson ready for "${sermonTitle}".`);
      router.refresh();
    } catch {
      setError(LESSON_FAILED);
    } finally {
      setGenerating(false);
    }
  }

  /** Rebuild the lesson from what was preached, not from the passages. */
  async function generateFromRecording(source: LessonRecordingSource, replace: boolean) {
    try {
      const res = await fetch(`/api/sermon-media/recordings/${source.recordingId}/lesson`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sermonId, replace }),
      });
      const data = (await res.json().catch(() => null)) as
        | { error?: unknown; code?: unknown }
        | null;
      if (res.status === 409 && data?.code === "draft_edited" && !replace) {
        const ok = await confirmAction({
          title: "Replace your changes?",
          description:
            "This lesson was changed after it was made. A new lesson from the recording replaces those changes.",
          confirmLabel: "Replace the lesson",
          destructive: true,
        });
        if (ok) await generateFromRecording(source, true);
        return;
      }
      if (!res.ok) {
        setError(typeof data?.error === "string" ? data.error : LESSON_FAILED);
        return;
      }
      toast.success(`New lesson ready for "${sermonTitle}", made from the recording.`);
      router.refresh();
    } catch {
      setError(LESSON_FAILED);
    } finally {
      setGenerating(false);
    }
  }

  const sourceNote = recordingSource ? (
    <div className="flex flex-col gap-2">
      <p className="text-[15px] text-muted-foreground">
        Made from the recording{" "}
        <Link
          href={`/dashboard/live-streaming/recordings/${recordingSource.recordingId}`}
          className="font-medium text-primary underline underline-offset-4 hover:text-accent"
        >
          &ldquo;{recordingSource.recordingTitle?.trim() || "Untitled recording"}&rdquo;
        </Link>
      </p>
      {recordingSource.needsReview && (
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone="attention">Needs review</StatusBadge>
          {recordingSource.reviewReason && (
            <span className="text-[15px] text-muted-foreground">{recordingSource.reviewReason}</span>
          )}
        </div>
      )}
    </div>
  ) : null;

  const scriptureToCheck = (recordingSource?.evidence.scripture ?? []).filter(
    (entry) => entry.status === "needs_verification",
  );

  if (!hasLesson) {
    return (
      <Card className="border-accent/40 bg-accent/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-6 text-accent" strokeWidth={1.75} />
            Turn this into a lesson
          </CardTitle>
          <p className="text-[15px] text-muted-foreground">
            Make a teaching outline and small-group discussion questions from
            {recordingSource ? "this recorded sermon" : "this sermon\u2019s passages"}, then print it or download it as a PDF.
          </p>
          {sourceNote}
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-2">
          <Button size="lg" disabled={generating} onClick={generateLesson}>
            {generating ? (
              <>
                <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
                Making your lesson…
              </>
            ) : (
              <>
                <Sparkles aria-hidden className="size-5" />
                Create lesson
              </>
            )}
          </Button>
          {generating && (
            <p className="text-sm text-muted-foreground" role="status">
              This usually takes 15 to 30 seconds.
            </p>
          )}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <BookOpen className="size-6 text-accent" strokeWidth={1.75} />
            Lesson
          </CardTitle>
          <p className="text-[15px] text-muted-foreground">
            Outline and discussion questions for {sermonTitle}.
          </p>
          {sourceNote && <div className="mt-2">{sourceNote}</div>}
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            nativeButton={false}
            render={
              <a href={`/api/sermon/${sermonId}/export/pdf`} download>
                <FileDown aria-hidden className="size-5" strokeWidth={1.75} />
                Download lesson (PDF)
              </a>
            }
          />
          <Button
            variant="outline"
            disabled={generating}
            onClick={generateLesson}
          >
            {generating ? (
              <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
            ) : (
              <RefreshCw aria-hidden className="size-5" />
            )}
            {generating ? "Making a new lesson…" : "Make a new lesson"}
          </Button>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {error && (
          <p role="alert" className="text-[15px] text-destructive">
            {error}
          </p>
        )}

        {outline && (
          <div className="flex flex-col gap-4">
            <section className="space-y-1">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Introduction
              </h3>
              <p className="text-[15px] leading-relaxed">{outline.intro}</p>
              <SourceLinks source={recordingSource} ids={recordingSource?.evidence.intro} />
            </section>

            {outline.points.map((point, i) => (
              <section key={i} className="space-y-1">
                <h3 className="font-heading text-base font-semibold">
                  {i + 1}. {point.title}
                </h3>
                <p className="text-[15px] leading-relaxed">{point.summary}</p>
                {point.scripture && (
                  <p className="text-sm text-muted-foreground">
                    {point.scripture}
                  </p>
                )}
                <SourceLinks source={recordingSource} ids={recordingSource?.positionsReliable ? recordingSource.evidence.points?.[i] : undefined} />
              </section>
            ))}

            <section className="space-y-1">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Application
              </h3>
              <p className="text-[15px] leading-relaxed">{outline.application}</p>
              <SourceLinks source={recordingSource} ids={recordingSource?.evidence.application} />
            </section>

            <section className="space-y-1">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Closing
              </h3>
              <p className="text-[15px] leading-relaxed">{outline.closing}</p>
              <SourceLinks source={recordingSource} ids={recordingSource?.evidence.closing} />
            </section>
          </div>
        )}

        {recordingSource && scriptureToCheck.length > 0 && (
          <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-4">
            <h3 className="flex items-center gap-2 text-[15px] font-semibold">
              <AlertTriangle aria-hidden className="size-5 text-amber-600 dark:text-amber-400" />
              Check these Bible references
            </h3>
            <p className="text-[15px] text-muted-foreground">
              We couldn&rsquo;t confirm these from the recording, so they aren&rsquo;t printed in the lesson yet.
            </p>
            <ul className="flex flex-col gap-2">
              {scriptureToCheck.map((entry, i) => (
                <li key={`${entry.ref}-${i}`} className="text-[15px]">
                  <span className="font-semibold">{entry.ref}</span>
                  {entry.reason && <span className="text-muted-foreground"> — {entry.reason}</span>}
                  <SourceLinks source={recordingSource} ids={entry.evidence} compact />
                </li>
              ))}
            </ul>
          </div>
        )}

        {questions.length > 0 && (
          <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-4">
            <h3 className="text-sm font-semibold text-muted-foreground">
              Discussion questions
            </h3>
            <ol className="flex flex-col gap-3">
              {questions.map((q, i) => (
                <li key={i} className="text-[15px]">
                  <span className="text-sm font-semibold text-muted-foreground">
                    {CATEGORY_LABEL[q.category] ?? q.category}
                  </span>
                  <p className="leading-relaxed">
                    {i + 1}. {q.question}
                  </p>
                  <SourceLinks source={recordingSource} ids={recordingSource?.positionsReliable ? recordingSource.evidence.questions?.[i] : undefined} compact />
                </li>
              ))}
            </ol>
          </div>
        )}

        <p className="text-[15px] text-muted-foreground">
          Only want different discussion questions?{" "}
          <Link
            href={`/dashboard/sermon-builder/${sermonId}/discussion`}
            className="font-medium text-primary underline underline-offset-4 hover:text-accent"
          >
            Open discussion questions
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
