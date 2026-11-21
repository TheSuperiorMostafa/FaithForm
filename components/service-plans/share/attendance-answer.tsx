"use client";

import { useState, useTransition } from "react";
import { Check, X } from "lucide-react";
import { answerPlanAction } from "@/app/plan/[token]/actions";
import { cn } from "@/lib/utils";

type Answer = "confirmed" | "declined";

/**
 * The two answers on a personal share link. Green and red, but each also says
 * what it means in words and shows a tick or a cross, so nothing depends on
 * colour alone. The chosen one stays filled; the other can still be tapped to
 * change the answer.
 */
export function AttendanceAnswer({
  token,
  initial,
  firstName,
  when,
}: {
  token: string;
  initial: Answer | null;
  firstName: string | null;
  when: string;
}) {
  const [answer, setAnswer] = useState<Answer | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [choosing, setChoosing] = useState<Answer | null>(null);

  const choose = (next: Answer) => {
    setError(null);
    setChoosing(next);
    start(async () => {
      const result = await answerPlanAction(token, next);
      setChoosing(null);
      if (!result.ok) return void setError(result.error);
      setAnswer(result.status);
    });
  };

  return (
    <section
      aria-labelledby="attendance-title"
      className="space-y-3 rounded-2xl border border-border bg-card p-4 sm:p-5"
    >
      <h2 id="attendance-title" className="font-heading text-lg font-bold">
        {firstName ? `${firstName}, can you be there?` : "Can you be there?"}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2" role="group" aria-label={`Your answer for ${when}`}>
        <button
          type="button"
          aria-pressed={answer === "confirmed"}
          disabled={pending}
          onClick={() => choose("confirmed")}
          className={cn(
            "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 px-5 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60",
            answer === "confirmed"
              ? "border-emerald-700 bg-emerald-700 text-white"
              : "border-emerald-700 text-emerald-800 hover:bg-emerald-50 dark:border-emerald-500 dark:text-emerald-300 dark:hover:bg-emerald-500/10",
          )}
        >
          <Check aria-hidden className="size-5" />
          {choosing === "confirmed" ? "Saving…" : "I’ll be there"}
        </button>
        <button
          type="button"
          aria-pressed={answer === "declined"}
          disabled={pending}
          onClick={() => choose("declined")}
          className={cn(
            "inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 px-5 text-base font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-60",
            answer === "declined"
              ? "border-red-700 bg-red-700 text-white"
              : "border-red-700 text-red-800 hover:bg-red-50 dark:border-red-500 dark:text-red-300 dark:hover:bg-red-500/10",
          )}
        >
          <X aria-hidden className="size-5" />
          {choosing === "declined" ? "Saving…" : "Can’t make it"}
        </button>
      </div>
      <p role="status" aria-live="polite" className="text-[15px] text-muted-foreground">
        {answer === "confirmed"
          ? "Thanks! We’ve told your church you’ll be there. Tap the other answer if that changes."
          : answer === "declined"
            ? "Thanks for letting us know. We’ve told your church you can’t make it. Tap “I’ll be there” if that changes."
            : "Your church will see your answer as soon as you tap one."}
      </p>
      {error && (
        <p role="alert" className="text-[15px] font-semibold text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}
