"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";
import {
  ScripturePicker,
  type ScripturePickerHandle,
} from "@/components/sermon-builder/scripture-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { CuratedTranslationOption } from "@/lib/bible/translations";
import {
  LESSON_MAKING_HINT,
  LESSON_MAKING_LABEL,
} from "@/lib/lesson-builder/page-copy";
import { nextSunday } from "@/lib/sermon-builder/sermon-display";

type SeriesOption = { id: string; title: string };

const START_FAILED = "We couldn't start the lesson. Please try again.";

/**
 * Lesson Builder's create form: the same choices a sermon starts with (title,
 * passages, translation, date, series), without a slide look. Saving creates
 * the lesson, then writes it with the existing outline call. If writing fails
 * the lesson still opens, where "Create lesson" tries again.
 */
export function NewLessonForm({
  translationOptions,
  defaultTranslation,
  series,
}: {
  translationOptions: CuratedTranslationOption[];
  defaultTranslation: string;
  series: SeriesOption[];
}) {
  const router = useRouter();
  const pickerRef = useRef<ScripturePickerHandle>(null);
  const [title, setTitle] = useState("");
  const [lessonDate, setLessonDate] = useState(() => nextSunday());
  const [translation, setTranslation] = useState(defaultTranslation);
  const [refs, setRefs] = useState<string[]>([]);
  const [seriesId, setSeriesId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setError(null);

    // A passage chosen but not yet added still counts.
    const pending = pickerRef.current?.commitPending() ?? null;
    const passages = pending && !refs.includes(pending) ? [...refs, pending] : refs;
    const trimmed = title.trim();

    const missing: string[] = [];
    if (!trimmed) missing.push("a title");
    if (passages.length === 0) missing.push("at least one Bible passage");
    if (missing.length > 0) {
      setError(`Add ${missing.join(" and ")} to make the lesson.`);
      return;
    }

    setBusy(true);
    let lessonId: string | null = null;
    try {
      const res = await fetch("/api/lessons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: trimmed,
          scripture_refs: passages,
          translation,
          sermon_date: lessonDate || null,
          series_id: seriesId || null,
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | { lessonId?: string; error?: unknown }
        | null;
      if (!res.ok || !data?.lessonId) {
        setError(typeof data?.error === "string" ? data.error : START_FAILED);
        setBusy(false);
        return;
      }
      lessonId = data.lessonId;
    } catch {
      setError(START_FAILED);
      setBusy(false);
      return;
    }

    try {
      const res = await fetch("/api/sermon/outline", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sermonId: lessonId,
          topic: trimmed,
          scripture_refs: passages,
          keep_title: true,
          include_questions: true,
        }),
      });
      if (res.ok) {
        toast.success(`Lesson ready: "${trimmed}".`);
      } else {
        toast.error(`"${trimmed}" was saved, but we couldn't write the lesson yet. Press Create lesson to try again.`);
      }
    } catch {
      toast.error(`"${trimmed}" was saved, but we couldn't write the lesson yet. Press Create lesson to try again.`);
    }
    router.push(`/dashboard/lesson-builder/${lessonId}`);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" aria-busy={busy}>
      <Card>
        <CardHeader>
          <CardTitle>Lesson details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="space-y-2">
            <Label htmlFor="lesson-title">Lesson title</Label>
            <Input
              id="lesson-title"
              value={title}
              maxLength={140}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Living water — John 4"
              disabled={busy}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="lesson-date">Lesson date</Label>
            <DatePicker id="lesson-date" value={lessonDate} onChange={setLessonDate} disabled={busy} />
            <p className="text-sm text-muted-foreground">
              The day you&rsquo;ll teach it. We picked the next Sunday for you.
            </p>
          </div>

          {series.length > 0 && (
            <div className="space-y-2">
              <Label htmlFor="lesson-series">Series (optional)</Label>
              <Select
                id="lesson-series"
                value={seriesId}
                onChange={(e) => setSeriesId(e.target.value)}
                disabled={busy}
              >
                <option value="">Not part of a series</option>
                {series.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.title}
                  </option>
                ))}
              </Select>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen aria-hidden className="size-6 text-accent" strokeWidth={1.75} />
            Bible passages
          </CardTitle>
          <p className="text-[15px] text-muted-foreground">
            Choose the book, chapter and verses the lesson teaches from.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="space-y-2">
            <Label htmlFor="lesson-translation">Bible translation</Label>
            <Select
              id="lesson-translation"
              value={translation}
              disabled={busy}
              onChange={(e) => {
                const option = translationOptions.find((t) => t.id === e.target.value);
                if (option?.enabled) setTranslation(option.id);
              }}
            >
              {translationOptions.map((t) => (
                <option key={t.id} value={t.id} disabled={!t.enabled}>
                  {t.label} ({t.shortName})
                  {!t.enabled ? " — Coming soon" : ""}
                </option>
              ))}
            </Select>
          </div>
          <ScripturePicker ref={pickerRef} value={refs} onChange={setRefs} />
        </CardContent>
      </Card>

      <div className="flex flex-col items-start gap-2">
        <Button type="submit" size="lg" disabled={busy}>
          {busy ? (
            <>
              <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
              {LESSON_MAKING_LABEL}
            </>
          ) : (
            <>
              <Sparkles aria-hidden className="size-5" />
              Make the lesson
            </>
          )}
        </Button>
        {busy && (
          <p className="text-sm text-muted-foreground" role="status">
            {LESSON_MAKING_HINT}
          </p>
        )}
        {error && (
          <p role="alert" className="text-[15px] text-destructive">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}
