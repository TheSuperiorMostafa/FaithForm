"use client";

import { useRef } from "react";
import { BookOpen, Mic, type LucideIcon } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  LESSON_START_OPTIONS,
  LESSON_START_QUESTION,
  type LessonStart,
} from "@/lib/lesson-builder/page-copy";
import { cn } from "@/lib/utils";

const ICONS: Record<LessonStart, LucideIcon> = { sermon: Mic, scripture: BookOpen };

/**
 * The first decision on "New lesson": build it from a past sermon, or start a
 * new lesson from Bible passages. Two big labelled choices (a radio group with
 * arrow-key movement). `loading.tsx` renders it with no choice and disabled,
 * so the skeleton shows the same real words in the same place.
 */
export function LessonStartChoice({
  value,
  onChange,
  disabled = false,
}: {
  value: LessonStart | null;
  onChange?: (value: LessonStart) => void;
  disabled?: boolean;
}) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const focusIndex = value ? LESSON_START_OPTIONS.findIndex((option) => option.value === value) : 0;

  function onKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
    const step = keys[event.key];
    if (!step) return;
    event.preventDefault();
    const next = (index + step + LESSON_START_OPTIONS.length) % LESSON_START_OPTIONS.length;
    onChange?.(LESSON_START_OPTIONS[next].value);
    refs.current[next]?.focus();
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle id="lesson-start-question">{LESSON_START_QUESTION}</CardTitle>
      </CardHeader>
      <CardContent>
        <div role="radiogroup" aria-labelledby="lesson-start-question" className="grid gap-3 sm:grid-cols-2">
          {LESSON_START_OPTIONS.map((option, index) => {
            const Icon = ICONS[option.value];
            const selected = value === option.value;
            return (
              <button
                key={option.value}
                ref={(element) => {
                  refs.current[index] = element;
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={index === focusIndex ? 0 : -1}
                disabled={disabled}
                onClick={() => onChange?.(option.value)}
                onKeyDown={(event) => onKeyDown(event, index)}
                className={cn(
                  "flex min-h-11 items-start gap-4 rounded-2xl border-2 p-5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed",
                  selected
                    ? "border-primary bg-primary/[0.06] dark:border-accent dark:bg-accent/10"
                    : "border-border bg-card hover:border-primary/40",
                )}
              >
                <span
                  aria-hidden
                  className="flex size-12 shrink-0 items-center justify-center rounded-xl bg-primary/[0.07] text-primary dark:bg-accent/15 dark:text-accent"
                >
                  <Icon className="size-6" strokeWidth={1.75} />
                </span>
                <span className="flex min-w-0 flex-col gap-1">
                  <span className="font-heading text-lg font-semibold leading-tight">{option.title}</span>
                  <span className="text-[15px] leading-relaxed text-muted-foreground">{option.description}</span>
                </span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
