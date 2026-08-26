"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, FileDown, Loader2, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
        const data = await res.json().catch(() => null);
        throw new Error(
          data?.error ?? "Could not build the lesson. Please try again.",
        );
      }

      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
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
          <p className="text-sm text-muted-foreground">
            Build a teaching outline and small-group discussion questions from
            the passages in this deck — then download the whole thing as a PDF.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-2">
          <Button size="lg" disabled={generating} onClick={generateLesson}>
            {generating ? (
              <>
                <Loader2 className="size-4 animate-spin" />
                Building your lesson…
              </>
            ) : (
              <>
                <Sparkles className="size-4" />
                Create lesson
              </>
            )}
          </Button>
          {generating && (
            <p className="text-xs text-muted-foreground">
              This usually takes 15–30 seconds.
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
          <p className="text-sm text-muted-foreground">
            Outline and discussion questions for {sermonTitle}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={generating}
            onClick={generateLesson}
          >
            {generating ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <RefreshCw className="size-4" />
            )}
            Regenerate
          </Button>
          <Button
            size="sm"
            nativeButton={false}
            render={
              <a href={`/api/sermon/${sermonId}/export/pdf`} download>
                <FileDown className="size-4" strokeWidth={1.75} />
                Download PDF
              </a>
            }
          />
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}

        {outline && (
          <div className="flex flex-col gap-4">
            <section className="space-y-1">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Introduction
              </h3>
              <p className="text-sm leading-relaxed">{outline.intro}</p>
            </section>

            {outline.points.map((point, i) => (
              <section key={i} className="space-y-1">
                <h3 className="font-heading text-base font-semibold">
                  {i + 1}. {point.title}
                </h3>
                <p className="text-sm leading-relaxed">{point.summary}</p>
                {point.scripture && (
                  <p className="text-xs text-muted-foreground">
                    {point.scripture}
                  </p>
                )}
              </section>
            ))}

            <section className="space-y-1">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Application
              </h3>
              <p className="text-sm leading-relaxed">{outline.application}</p>
            </section>

            <section className="space-y-1">
              <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                Closing
              </h3>
              <p className="text-sm leading-relaxed">{outline.closing}</p>
            </section>
          </div>
        )}

        {questions.length > 0 && (
          <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-4">
            <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Discussion questions
            </h3>
            <ol className="flex flex-col gap-3">
              {questions.map((q, i) => (
                <li key={i} className="text-sm">
                  <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
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
      </CardContent>
    </Card>
  );
}
