"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Loader2, Plus, X } from "lucide-react";
import {
  fetchBooksAction,
  fetchChapterAction,
} from "@/app/dashboard/sermon-builder/actions";
import { SlidePreview } from "@/components/sermon-builder/slide-preview";
import { ThemePicker } from "@/components/sermon-builder/theme-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  extractVersesFromChapter,
  sliceVerses,
} from "@/lib/bible/render";
import type {
  RenderedVerse,
  Translation,
  TranslationBook,
} from "@/lib/bible/types";
import { buildScriptureRef } from "@/lib/sermon-builder/parse-ref";
import { DEFAULT_THEME_ID } from "@/lib/sermon-builder/themes";
import {
  MAX_SIMPLE_PASSAGES,
  type SimplePassageInput,
} from "@/lib/sermon-builder/types";

type SavedPassage = {
  id: string;
  ref: string;
  book: string;
  bookId: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
};

type SimpleSermonBuilderProps = {
  translations: Translation[];
  initial?: {
    title?: string;
    translation?: string;
    book?: string;
    chapter?: number;
    verseStart?: number;
    verseEnd?: number;
    themeId?: string;
  };
};

function passageKey(p: {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
}) {
  return `${p.book}|${p.chapter}|${p.verseStart}|${p.verseEnd}`;
}

export function SimpleSermonBuilder({
  translations,
  initial,
}: SimpleSermonBuilderProps) {
  const router = useRouter();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [translation, setTranslation] = useState(
    initial?.translation ?? translations[0]?.id ?? "BSB",
  );
  const [books, setBooks] = useState<TranslationBook[]>([]);
  const [booksLoading, setBooksLoading] = useState(false);
  const [bookId, setBookId] = useState("");
  const [chapter, setChapter] = useState<number | "">(initial?.chapter ?? "");
  const [verseStart, setVerseStart] = useState<number | "">(
    initial?.verseStart ?? "",
  );
  const [verseEnd, setVerseEnd] = useState<number | "">(
    initial?.verseEnd ?? "",
  );
  const [passages, setPassages] = useState<SavedPassage[]>([]);
  const [maxVerses, setMaxVerses] = useState(0);
  const [previewVerses, setPreviewVerses] = useState<RenderedVerse[]>([]);
  const [previewRef, setPreviewRef] = useState("");
  const [previewTranslation, setPreviewTranslation] = useState("");
  const [chapterLoading, setChapterLoading] = useState(false);
  const [chapterError, setChapterError] = useState<string | null>(null);
  const [booksError, setBooksError] = useState<string | null>(null);
  const [themeId, setThemeId] = useState(initial?.themeId ?? DEFAULT_THEME_ID);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selectedBook = useMemo(
    () => books.find((b) => b.id === bookId),
    [books, bookId],
  );

  const englishTranslations = useMemo(
    () =>
      translations.filter(
        (t) =>
          t.language === "eng" ||
          t.languageEnglishName?.toLowerCase().includes("english"),
      ),
    [translations],
  );

  const translationOptions =
    englishTranslations.length > 0 ? englishTranslations : translations;

  const loadBooks = useCallback(async (transId: string) => {
    setBooksLoading(true);
    setBooksError(null);
    try {
      const data = await fetchBooksAction(transId);
      setBooks(data.books);
      if (initial?.book) {
        const match = data.books.find(
          (b) =>
            b.name.toLowerCase() === initial.book!.toLowerCase() ||
            b.commonName.toLowerCase() === initial.book!.toLowerCase(),
        );
        if (match) setBookId(match.id);
      }
    } catch (e) {
      setBooks([]);
      setBooksError(
        e instanceof Error ? e.message : "Could not load books for this translation",
      );
    } finally {
      setBooksLoading(false);
    }
  }, [initial?.book]);

  useEffect(() => {
    if (translation) loadBooks(translation);
  }, [translation, loadBooks]);

  useEffect(() => {
    if (!translation || !bookId || !chapter) {
      setPreviewVerses([]);
      setMaxVerses(0);
      return;
    }

    let cancelled = false;
    setChapterLoading(true);
    setChapterError(null);

    fetchChapterAction(translation, bookId, Number(chapter))
      .then((data) => {
        if (cancelled) return;
        const all = extractVersesFromChapter(data);
        setMaxVerses(data.numberOfVerses);
        setPreviewTranslation(
          data.translation.shortName ?? data.translation.name,
        );

        const start = verseStart === "" ? 1 : Number(verseStart);
        const end =
          verseEnd === "" ? (verseStart === "" ? all.length : start) : Number(verseEnd);
        const sliced = sliceVerses(all, start, end);
        setPreviewVerses(sliced);

        const bookName = data.book.commonName || data.book.name;
        setPreviewRef(
          buildScriptureRef(bookName, Number(chapter), start, end || start),
        );
      })
      .catch((e) => {
        if (!cancelled) {
          setPreviewVerses([]);
          setMaxVerses(0);
          setChapterError(
            e instanceof Error ? e.message : "Could not load chapter preview",
          );
        }
      })
      .finally(() => {
        if (!cancelled) setChapterLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [translation, bookId, chapter, verseStart, verseEnd]);

  const buildDraftPassage = useCallback((): SimplePassageInput | null => {
    if (!selectedBook || !chapter) return null;
    const start = verseStart === "" ? 1 : Number(verseStart);
    const end = verseEnd === "" ? start : Number(verseEnd);
    if (end < start) return null;
    return {
      book: selectedBook.commonName || selectedBook.name,
      chapter: Number(chapter),
      verseStart: start,
      verseEnd: end,
    };
  }, [selectedBook, chapter, verseStart, verseEnd]);

  const draftPassage = buildDraftPassage();
  const isDraftValid = draftPassage !== null;

  const collectPassagesForSave = useCallback((): SimplePassageInput[] => {
    const saved: SimplePassageInput[] = passages.map((p) => ({
      book: p.book,
      chapter: p.chapter,
      verseStart: p.verseStart,
      verseEnd: p.verseEnd,
    }));

    if (!draftPassage) return saved;

    const draftKey = passageKey(draftPassage);
    const lastKey =
      saved.length > 0 ? passageKey(saved[saved.length - 1]!) : null;
    if (draftKey !== lastKey) {
      saved.push(draftPassage);
    }

    return saved;
  }, [passages, draftPassage]);

  const totalPassageCount = collectPassagesForSave().length;

  const canSubmit = Boolean(
    title.trim() && translation && themeId && totalPassageCount >= 1,
  );

  const canAddPassage = Boolean(
    isDraftValid && passages.length < MAX_SIMPLE_PASSAGES,
  );

  const missingFields: string[] = [];
  if (!title.trim()) missingFields.push("a name");
  if (totalPassageCount < 1) missingFields.push("at least one passage");

  function handleAddPassage() {
    if (!canAddPassage || !draftPassage || !selectedBook) return;

    const ref = buildScriptureRef(
      draftPassage.book,
      draftPassage.chapter,
      draftPassage.verseStart,
      draftPassage.verseEnd,
    );

    setPassages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        ref,
        book: draftPassage.book,
        bookId,
        chapter: draftPassage.chapter,
        verseStart: draftPassage.verseStart,
        verseEnd: draftPassage.verseEnd,
      },
    ]);
    setChapter("");
    setVerseStart("");
    setVerseEnd("");
  }

  function handleRemovePassage(id: string) {
    setPassages((prev) => prev.filter((p) => p.id !== id));
  }

  async function handleDownload() {
    if (!canSubmit) return;
    const allPassages = collectPassagesForSave();
    if (allPassages.length === 0) return;

    setSaving(true);
    setError(null);

    try {
      const res = await fetch("/api/sermon/simple", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title.trim(),
          translation,
          passages: allPassages,
          theme_id: themeId,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Could not save slide deck");
      }

      const sermonId = data.sermon?.id;
      if (!sermonId) throw new Error("No sermon ID returned");

      const link = document.createElement("a");
      link.href = `/api/sermon/${sermonId}/export/pptx`;
      link.download = "";
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      router.push(`/dashboard/sermon-builder/${sermonId}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Slide deck details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="space-y-2">
            <Label htmlFor="deck-title">Sermon / deck name</Label>
            <Input
              id="deck-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Sunday Morning — John 3"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="translation">Bible translation</Label>
            <select
              id="translation"
              value={translation}
              onChange={(e) => {
                setTranslation(e.target.value);
                setBookId("");
                setChapter("");
                setVerseStart("");
                setVerseEnd("");
                setPassages([]);
              }}
              className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {translationOptions.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.englishName || t.name} ({t.shortName})
                </option>
              ))}
            </select>
          </div>

          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="book">Book</Label>
              <select
                id="book"
                value={bookId}
                onChange={(e) => {
                  setBookId(e.target.value);
                  setChapter("");
                  setVerseStart("");
                  setVerseEnd("");
                }}
                disabled={booksLoading || books.length === 0}
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
              >
                <option value="">
                  {booksLoading
                    ? "Loading…"
                    : booksError
                      ? "Could not load books"
                      : "Select a book"}
                </option>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.commonName || b.name}
                  </option>
                ))}
              </select>
              {booksError && (
                <p className="text-xs text-destructive">{booksError}</p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="chapter">Chapter</Label>
              <Input
                id="chapter"
                type="number"
                min={1}
                max={selectedBook?.numberOfChapters}
                value={chapter}
                onChange={(e) => {
                  const n = e.target.value === "" ? "" : Number(e.target.value);
                  setChapter(n);
                  setVerseStart("");
                  setVerseEnd("");
                }}
                disabled={!bookId}
                placeholder="—"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="verseStart">Verse</Label>
              <Input
                id="verseStart"
                type="number"
                min={1}
                max={maxVerses || undefined}
                value={verseStart}
                onChange={(e) =>
                  setVerseStart(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                disabled={!chapter}
                placeholder="1"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="verseEnd">To (optional)</Label>
              <Input
                id="verseEnd"
                type="number"
                min={Number(verseStart) || 1}
                max={maxVerses || undefined}
                value={verseEnd}
                onChange={(e) =>
                  setVerseEnd(
                    e.target.value === "" ? "" : Number(e.target.value),
                  )
                }
                disabled={!chapter}
                placeholder="same"
              />
            </div>
          </div>

          {passages.length > 0 && (
            <ul className="flex flex-col gap-2">
              {passages.map((p, index) => (
                <li
                  key={p.id}
                  className="flex items-center justify-between gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
                >
                  <span>
                    <span className="text-muted-foreground">{index + 1}.</span>{" "}
                    <strong className="text-foreground">{p.ref}</strong>
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    aria-label={`Remove ${p.ref}`}
                    onClick={() => handleRemovePassage(p.id)}
                  >
                    <X className="size-4" />
                  </Button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">
              {previewRef ? (
                <>
                  Passage:{" "}
                  <strong className="text-foreground">{previewRef}</strong>
                  {chapterLoading && " — loading preview…"}
                </>
              ) : passages.length > 0 ? (
                <>
                  Passages ({passages.length}):{" "}
                  <strong className="text-foreground">
                    {passages.map((p) => p.ref).join(" · ")}
                  </strong>
                </>
              ) : (
                "Select a book and chapter to add a passage."
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canAddPassage}
              onClick={handleAddPassage}
            >
              <Plus className="size-4" />
              Add
            </Button>
          </div>

          {passages.length >= MAX_SIMPLE_PASSAGES && (
            <p className="text-xs text-muted-foreground">
              Maximum {MAX_SIMPLE_PASSAGES} passages per deck.
            </p>
          )}

          {chapterError && (
            <p className="text-xs text-destructive">
              Couldn&apos;t load a live preview ({chapterError}). You can still
              save and download — verses will be fetched again at export time.
            </p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Slide theme</CardTitle>
          <p className="text-sm text-muted-foreground">
            Each verse chunk fills the entire slide.
          </p>
        </CardHeader>
        <CardContent>
          <ThemePicker selectedId={themeId} onSelect={setThemeId} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SlidePreview
            themeId={themeId}
            verses={previewVerses}
            reference={previewRef}
            translation={previewTranslation}
          />
          {totalPassageCount > 1 && (
            <p className="text-xs text-muted-foreground">
              {totalPassageCount} passages in this deck — preview shows the
              current selection.
            </p>
          )}
          {previewVerses.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Long passages are split across multiple slides automatically so
              text stays as large as possible.
            </p>
          )}
        </CardContent>
      </Card>

      {error && (
        <p
          role="alert"
          className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col items-start gap-2">
        <Button
          size="lg"
          className="w-full sm:w-auto"
          disabled={!canSubmit || saving}
          onClick={handleDownload}
        >
          {saving ? (
            <>
              <Loader2 className="size-4 animate-spin" />
              Creating deck…
            </>
          ) : (
            <>
              <Download className="size-4" />
              Save &amp; download PowerPoint
            </>
          )}
        </Button>
        {!canSubmit && missingFields.length > 0 && (
          <p className="text-xs text-muted-foreground">
            Add {missingFields.join(" and ")} to continue.
          </p>
        )}
      </div>
    </div>
  );
}
