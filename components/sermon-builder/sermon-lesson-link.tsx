"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, FileDown, GraduationCap, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LESSON_MAKING_HINT,
  LESSON_MAKING_LABEL,
} from "@/lib/lesson-builder/page-copy";
import type { SermonOutline } from "@/types/sermon";

const LESSON_FAILED =
  "We couldn't make the lesson just now. Nothing was changed. Please try again in a minute.";

/**
 * The sermon page's Lesson tab: a short card that points to Lesson Builder,
 * where the full lesson lives. A sermon without a lesson can make one here,
 * which then opens in Lesson Builder.
 */
export function SermonLessonLink({
  sermonId,
  sermonTitle,
  scriptureRefs,
  outline,
}: {
  sermonId: string;
  sermonTitle: string;
  scriptureRefs: string[];
  outline: SermonOutline | null;
}) {
  const router = useRouter();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lessonHref = `/dashboard/lesson-builder/${sermonId}`;

  async function makeLesson() {
    setGenerating(true);
    setError(null);
    try {
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
        setGenerating(false);
        return;
      }
      toast.success(`Lesson ready for "${sermonTitle}". It's in Lessons too.`);
      router.push(lessonHref);
    } catch {
      setError(LESSON_FAILED);
      setGenerating(false);
    }
  }

  if (!outline) {
    return (
      <Card className="border-accent/40 bg-accent/5">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <GraduationCap aria-hidden className="size-6 text-accent" strokeWidth={1.75} />
            Make a lesson from this sermon
          </CardTitle>
          <p className="text-[15px] text-muted-foreground">
            A teaching outline and small-group discussion questions from this
            sermon&rsquo;s passages. It opens in Lessons, where you can print it
            or download it as a PDF.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col items-start gap-2">
          <Button size="lg" disabled={generating} onClick={makeLesson}>
            {generating ? (
              <>
                <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
                {LESSON_MAKING_LABEL}
              </>
            ) : (
              <>
                <Sparkles aria-hidden className="size-5" />
                Make a lesson
              </>
            )}
          </Button>
          {generating && (
            <p className="text-sm text-muted-foreground" role="status">
              {LESSON_MAKING_HINT}
            </p>
          )}
          {error && (
            <p role="alert" className="text-[15px] text-destructive">
              {error}
            </p>
          )}
        </CardContent>
      </Card>
    );
  }

  const pointCount = outline.points?.length ?? 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GraduationCap aria-hidden className="size-6 text-accent" strokeWidth={1.75} />
          {outline.title?.trim() || sermonTitle}
        </CardTitle>
        <p className="text-[15px] text-muted-foreground">
          This sermon&rsquo;s lesson has {pointCount} {pointCount === 1 ? "point" : "points"} and
          discussion questions. Open it in Lessons to read, change or print it.
        </p>
      </CardHeader>
      <CardContent className="flex flex-wrap gap-3">
        <Button size="lg" nativeButton={false} render={<Link href={lessonHref} />}>
          Open in Lesson Builder
          <ArrowRight aria-hidden className="size-5" />
        </Button>
        <Button
          size="lg"
          variant="outline"
          nativeButton={false}
          render={
            <a href={`/api/sermon/${sermonId}/export/pdf`} download>
              <FileDown aria-hidden className="size-5" strokeWidth={1.75} />
              Download lesson (PDF)
            </a>
          }
        />
      </CardContent>
    </Card>
  );
}
