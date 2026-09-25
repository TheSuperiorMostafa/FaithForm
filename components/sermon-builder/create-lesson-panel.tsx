"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BookOpen, FileDown, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import type { DiscussionQuestion, SermonOutline } from "@/types/sermon";

type CreateLessonPanelProps = {
  sermonId: string;
  sermonTitle: string;
  scriptureRefs: string[];
  outline: SermonOutline | null;
  questions: DiscussionQuestion[];
};

const CATEGORY_LABEL: Record<DiscussionQuestion["category"], string> = {
  warmup: "Warm-up",
  observation: "Observation",
  interpretation: "Interpretation",
  application: "Application",
};

const LESSON_FAILED =
  "We couldn't make the lesson just now. Nothing was changed. Please try again in a minute.";

export function CreateLessonPanel({
  sermonId,
  sermonTitle,
  scriptureRefs,
  outline,
  questions,
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
            this sermon&rsquo;s passages, then print it or download it as a PDF.
          </p>
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
              </section>
            ))}

            <section className="space-y-1">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Application
              </h3>
              <p className="text-[15px] leading-relaxed">{outline.application}</p>
            </section>

            <section className="space-y-1">
              <h3 className="text-sm font-semibold text-muted-foreground">
                Closing
              </h3>
              <p className="text-[15px] leading-relaxed">{outline.closing}</p>
            </section>
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
