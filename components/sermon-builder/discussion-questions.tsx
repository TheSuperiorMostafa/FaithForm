"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ModelBadge } from "@/components/sermon-builder/model-badge";
import type { DiscussionQuestion } from "@/types/sermon";

const categoryLabels: Record<DiscussionQuestion["category"], string> = {
  warmup: "Warm-up",
  observation: "Observation",
  interpretation: "Interpretation",
  application: "Application",
};

export function DiscussionQuestions({
  sermonId,
  initial,
}: {
  sermonId: string;
  initial?: DiscussionQuestion[];
}) {
  const [questions, setQuestions] = useState<DiscussionQuestion[]>(initial ?? []);
  const [modelUsed, setModelUsed] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/sermon/discussion", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sermonId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed");
      setQuestions(data.questions);
      setModelUsed(data.modelUsed);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed");
    } finally {
      setLoading(false);
    }
  }

  function copyAll() {
    const text = questions
      .map((q) => `[${categoryLabels[q.category]}] ${q.question}`)
      .join("\n\n");
    void navigator.clipboard.writeText(text);
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={generate} disabled={loading}>
          {loading ? "Generating…" : questions.length ? "Regenerate" : "Generate questions"}
        </Button>
        {questions.length > 0 && (
          <Button variant="outline" onClick={copyAll}>
            Copy all
          </Button>
        )}
        <ModelBadge model={modelUsed} />
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <ul className="flex flex-col gap-3">
        {questions.map((q, i) => (
          <li key={i}>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="font-heading text-xs font-semibold uppercase tracking-wide text-accent">
                  {categoryLabels[q.category]}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm">{q.question}</p>
              </CardContent>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
