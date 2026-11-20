"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Loader2, Mic, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { LessonStartChoice } from "@/components/lesson-builder/lesson-start-choice";
import {
  ScripturePicker,
  type ScripturePickerHandle,
} from "@/components/sermon-builder/scripture-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { SearchPicker, type PickerItem } from "@/components/ui/search-picker";
import { Select } from "@/components/ui/select";
import type { CuratedTranslationOption } from "@/lib/bible/translations";
import {
  LESSON_FROM_SERMON_HINT,
  LESSON_MAKING_HINT,
  LESSON_MAKING_LABEL,
  type LessonStart,
} from "@/lib/lesson-builder/page-copy";
import type { PastSermonOption } from "@/lib/lesson-builder/past-sermons";

const START_FAILED = "We couldn't start the lesson. Please try again.";
const FROM_SERMON_FAILED = "We couldn't make the lesson from this sermon. Please try again.";

/**
 * Lesson Builder's create form. A lesson starts one of two ways:
 *
 *   From a past sermon — pick the sermon by title. The server builds the
 *   lesson from its transcript only, and the Bible passages come from the
 *   sermon, so none are chosen here.
 *   New lesson — a title and the Bible passages. Saving creates the lesson,
 *   then writes it with the existing outline call. If writing fails the
 *   lesson still opens, where "Create lesson" tries again.
 *
 * There is no series or lesson date to fill in.
 */
export function NewLessonForm({
  translationOptions,
  defaultTranslation,
  pastSermons,
  pastSermonsAvailable,
}: {
  translationOptions: CuratedTranslationOption[];
  defaultTranslation: string;
  pastSermons: PastSermonOption[];
  pastSermonsAvailable: boolean;
}) {
  const router = useRouter();
  const pickerRef = useRef<ScripturePickerHandle>(null);
  const [start, setStart] = useState<LessonStart | null>(null);
  const [recordingIds, setRecordingIds] = useState<string[]>([]);
  const [title, setTitle] = useState("");
  const [translation, setTranslation] = useState(defaultTranslation);
  const [refs, setRefs] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sermonItems = useMemo<PickerItem[]>(
    () => pastSermons.map((sermon) => ({ id: sermon.id, label: sermon.title, description: sermon.when })),
    [pastSermons],
  );

  function choose(next: LessonStart) {
    if (busy) return;
    setStart(next);
    setError(null);
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !start) return;
    setError(null);
    if (start === "sermon") await makeFromSermon();
    else await makeFromScripture();
  }

  async function makeFromSermon() {
    const recordingId = recordingIds[0];
    if (!recordingId) {
      setError("Choose a past sermon to make the lesson.");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/lessons", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: "sermon", recording_id: recordingId }),
      });
      const data = (await res.json().catch(() => null)) as
        | { lessonId?: string; title?: string; error?: unknown }
        | null;
      if (!res.ok || !data?.lessonId) {
        setError(typeof data?.error === "string" ? data.error : FROM_SERMON_FAILED);
        setBusy(false);
        return;
      }
      toast.success(`Lesson ready: "${data.title ?? "your lesson"}", made from the sermon.`);
      router.push(`/dashboard/lesson-builder/${data.lessonId}`);
    } catch {
      setError(FROM_SERMON_FAILED);
      setBusy(false);
    }
  }

  async function makeFromScripture() {
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
          source: "scripture",
          title: trimmed,
          scripture_refs: passages,
          translation,
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

  const sermonReady = pastSermonsAvailable && pastSermons.length > 0;
  const canSubmit = start === "scripture" || (start === "sermon" && sermonReady);

  return (
    <form onSubmit={submit} className="flex flex-col gap-6" aria-busy={busy}>
      <LessonStartChoice value={start} onChange={choose} disabled={busy} />

      {start === "sermon" && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Mic aria-hidden className="size-6 text-accent" strokeWidth={1.75} />
              Past sermon
            </CardTitle>
            <p className="text-[15px] text-muted-foreground">
              The lesson is built only from what was said in this sermon.
            </p>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {!pastSermonsAvailable ? (
              <p className="text-[15px] text-muted-foreground">
                Past sermons show up here once Transcripts &amp; Clips is turned on for your church.
                For now, choose <span className="font-semibold text-foreground">New lesson</span> to start from Bible passages.
              </p>
            ) : pastSermons.length === 0 ? (
              <p className="text-[15px] text-muted-foreground">
                No sermons with a transcript yet. Once a service recording or uploaded sermon has a transcript, it shows
                up here. For now, choose <span className="font-semibold text-foreground">New lesson</span> to start from
                Bible passages.
              </p>
            ) : (
              <>
                <SearchPicker
                  items={sermonItems}
                  value={recordingIds}
                  onChange={(ids) => {
                    setRecordingIds(ids);
                    setError(null);
                  }}
                  label="Sermon"
                  placeholder="Search by sermon title…"
                  emptyText="No sermon has that title."
                  showAllWhenEmpty
                />
                <div className="flex items-start gap-3 rounded-xl bg-muted/60 p-4">
                  <BookOpen aria-hidden className="mt-0.5 size-5 shrink-0 text-accent" strokeWidth={1.75} />
                  <p className="text-[15px] text-muted-foreground">
                    <span className="font-semibold text-foreground">Bible passages</span> are taken from the sermon
                    automatically: the verses the pastor read and preached from.
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      )}

      {start === "scripture" && (
        <>
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
        </>
      )}

      {canSubmit && (
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
              {start === "sermon" ? LESSON_FROM_SERMON_HINT : LESSON_MAKING_HINT}
            </p>
          )}
          {error && (
            <p role="alert" className="text-[15px] text-destructive">
              {error}
            </p>
          )}
        </div>
      )}
    </form>
  );
}
