"use client";

import { useState } from "react";
import { Copy, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import type { DiscussionQuestion } from "@/types/sermon";

const categoryLabels: Record<DiscussionQuestion["category"], string> = {
  warmup: "Warm-up",
  observation: "Observation",
  interpretation: "Interpretation",
  application: "Application",
};

const WRITE_FAILED =
  "We couldn't write the questions just now. Nothing was changed. Please try again in a minute.";

export function DiscussionQuestions({
  sermonId,
  initial,
}: {
  sermonId: string;
  initial?: DiscussionQuestion[];
}) {
  const [questions, setQuestions] = useState<DiscussionQuestion[]>(initial ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (questions.length > 0) {
      const ok = await confirmAction({
        title: "Write new questions?",
        description:
          "This replaces the questions below, and the ones in the lesson, with new ones.",
        confirmLabel: "Write new questions",
      });
      if (!ok) return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sermon/discussion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sermonId }),
      });
      const data = (await res.json().catch(() => null)) as {
        questions?: DiscussionQuestion[];
        error?: unknown;
      } | null;
      if (!res.ok || !Array.isArray(data?.questions)) {
        setError(typeof data?.error === "string" ? data.error : WRITE_FAILED);
        return;
      }
      setQuestions(data.questions);
      toast.success("New discussion questions are ready.");
    } catch {
      setError(WRITE_FAILED);
    } finally {
      setLoading(false);
    }
  }

  async function copyAll() {
    const text = questions
      .map((q) => `[${categoryLabels[q.category]}] ${q.question}`)
      .join("\n\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("All questions copied.");
    } catch {
      toast.error("We couldn't copy the questions. Select the text and copy it yourself.");
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={generate} disabled={loading} variant={questions.length ? "outline" : "default"}>
          {loading ? (
            <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
          ) : (
            <Sparkles aria-hidden className="size-5" />
          )}
          {loading ? "Writing questions…" : questions.length ? "Write new questions" : "Write questions"}
        </Button>
        {questions.length > 0 && (
          <Button variant="outline" onClick={() => void copyAll()}>
            <Copy aria-hidden className="size-5" />
            Copy all questions
          </Button>
        )}
      </div>
      {error && (
        <p role="alert" className="text-[15px] text-destructive">
          {error}
        </p>
      )}
      <ol className="flex flex-col gap-3">
        {questions.map((q, i) => (
          <li key={i}>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-accent">
                  {categoryLabels[q.category]}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-base leading-relaxed">{q.question}</p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ol>
    </div>
  );
}
