"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BookOpen, Check, Loader2, Plus, Save, X } from "lucide-react";
import { toast } from "sonner";
import {
  fetchBooksAction,
  fetchChapterAction,
} from "@/app/dashboard/sermon-builder/actions";
import { SlidePreview } from "@/components/sermon-builder/slide-preview";
import { ThemePicker } from "@/components/sermon-builder/theme-picker";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { confirmAction } from "@/components/ui/confirm-dialog";
import { DatePicker } from "@/components/ui/date-picker";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import {
  extractVersesFromChapter,
  sliceVerses,
} from "@/lib/bible/render";
import type {
  RenderedVerse,
  TranslationBook,
} from "@/lib/bible/types";
import type { CuratedTranslationOption } from "@/lib/bible/translations";
import {
  clearLocalDraft,
  hasDraftContent,
  localDraftKey,
  readLocalDraft,
  writeLocalDraft,
  type LocalSermonDraft,
} from "@/lib/sermon-builder/local-draft";
import { buildScriptureRef } from "@/lib/sermon-builder/parse-ref";
import { nextSunday } from "@/lib/sermon-builder/sermon-display";
import { DEFAULT_THEME_ID } from "@/lib/sermon-builder/themes";
import type { SlideTheme } from "@/lib/sermon-builder/slide-theme-shared";
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
  translationOptions: CuratedTranslationOption[];
  defaultTranslation: string;
  editSermon?: {
    id: string;
    title: string;
    translation: string;
    themeId: string;
    sermonDate: string | null;
    /** A kept draft older than this is stale and is not offered back. */
    updatedAt?: string | null;
    passages: Array<{
      ref: string;
      book: string;
      chapter: number;
      verseStart: number;
      verseEnd: number;
    }>;
  };
  initial?: {
    title?: string;
    translation?: string;
    book?: string;
    chapter?: number;
    verseStart?: number;
    verseEnd?: number;
    themeId?: string;
    sermonDate?: string;
  };
  /** Set when started from a week in a series plan. */
  seriesId?: string;
};

/** Keeps a typed number inside [min, max]; "" while the field is empty. */
function clampNumber(
  raw: string,
  min: number,
  max: number | undefined,
): number | "" {
  if (raw === "") return "";
  const n = Number(raw);
  if (!Number.isFinite(n)) return "";
  const floored = Math.max(min, Math.floor(n));
  return max ? Math.min(floored, max) : floored;
}

function passageKey(p: {
  book: string;
  chapter: number;
  verseStart: number;
  verseEnd: number;
}) {
  return `${p.book}|${p.chapter}|${p.verseStart}|${p.verseEnd}`;
}

function matchBook(books: TranslationBook[], name: string): TranslationBook | undefined {
  const wanted = name.trim().toLowerCase();
  return books.find(
    (b) => b.name.toLowerCase() === wanted || b.commonName.toLowerCase() === wanted,
  );
}

const SAVE_FAILED = "We couldn't save your sermon. Your work is still here. Please try again.";

export function SimpleSermonBuilder({
  translationOptions,
  defaultTranslation,
  editSermon,
  initial,
  seriesId,
}: SimpleSermonBuilderProps) {
  const router = useRouter();
  const isEditing = Boolean(editSermon);
  // A sermon started from a series week keeps its own draft, so an unrelated
  // unsaved sermon never replaces the week's title and passage.
  const draftKey = localDraftKey(
    editSermon?.id ??
      (seriesId || initial?.title || initial?.book
        ? `new:${seriesId ?? ""}:${initial?.title ?? ""}:${initial?.book ?? ""}:${initial?.chapter ?? ""}`
        : null),
  );

  const [title, setTitle] = useState(
    editSermon?.title ?? initial?.title ?? "",
  );
  const [sermonDate, setSermonDate] = useState(
    () => editSermon?.sermonDate ?? initial?.sermonDate ?? nextSunday(),
  );
  const [translation, setTranslation] = useState(
    editSermon?.translation ?? initial?.translation ?? defaultTranslation,
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
  const [passages, setPassages] = useState<SavedPassage[]>(() =>
    editSermon
      ? editSermon.passages.map((p) => ({
          id: crypto.randomUUID(),
          ref: p.ref,
          book: p.book,
          bookId: "",
          chapter: p.chapter,
          verseStart: p.verseStart,
          verseEnd: p.verseEnd,
        }))
      : [],
  );
  const [maxVerses, setMaxVerses] = useState(0);
  // Whole chapter, fetched once per book/chapter. Verse start/end then slice
  // locally so changing a verse number repaints instantly instead of refetching.
  const [chapterVerses, setChapterVerses] = useState<RenderedVerse[]>([]);
  const [chapterBookName, setChapterBookName] = useState("");
  const [previewRef, setPreviewRef] = useState("");
  const [previewTranslation, setPreviewTranslation] = useState("");
  const [chapterLoading, setChapterLoading] = useState(false);
  const [chapterError, setChapterError] = useState(false);
  const [booksError, setBooksError] = useState(false);
  const [themeId, setThemeId] = useState(
    editSermon?.themeId ?? initial?.themeId ?? DEFAULT_THEME_ID,
  );
  const [loadedThemes, setLoadedThemes] = useState<SlideTheme[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Unsaved-work tracking. `dirty` flips only on what the person does, never
  // on the page's own clean-ups (a retired theme swapped for a current one).
  const [dirty, setDirty] = useState(false);
  const [keptLocally, setKeptLocally] = useState(false);
  const [restoredFrom, setRestoredFrom] = useState<string | null>(null);
  const pendingBookRef = useRef<string | null>(initial?.book ?? null);
  const pendingSelectionRef = useRef<LocalSermonDraft["current"]>(null);
  const booksRef = useRef<TranslationBook[]>([]);
  const touch = useCallback(() => setDirty(true), []);

  const selectedBook = useMemo(
    () => books.find((b) => b.id === bookId),
    [books, bookId],
  );

  const enabledTranslation = translationOptions.find(
    (t) => t.id === translation && t.enabled,
  );

  useEffect(() => {
    const current = translationOptions.find((t) => t.id === translation);
    if (!current?.enabled) {
      const fallback =
        translationOptions.find((t) => t.enabled)?.id ?? defaultTranslation;
      setTranslation(fallback);
    }
  }, [translation, translationOptions, defaultTranslation]);

  const applyPendingBook = useCallback((list: TranslationBook[]) => {
    const pending = pendingBookRef.current;
    if (!pending) return;
    const match = matchBook(list, pending);
    pendingBookRef.current = null;
    if (!match) return;
    setBookId(match.id);
    const selection = pendingSelectionRef.current;
    if (selection) {
      pendingSelectionRef.current = null;
      setChapter(selection.chapter);
      setVerseStart(selection.verseStart);
      setVerseEnd(selection.verseEnd);
    }
  }, []);

  const loadBooks = useCallback(async (transId: string) => {
    setBooksLoading(true);
    setBooksError(false);
    try {
      const data = await fetchBooksAction(transId);
      booksRef.current = data.books;
      setBooks(data.books);
      applyPendingBook(data.books);
    } catch {
      booksRef.current = [];
      setBooks([]);
      setBooksError(true);
    } finally {
      setBooksLoading(false);
    }
  }, [applyPendingBook]);

  useEffect(() => {
    if (translation) loadBooks(translation);
  }, [translation, loadBooks]);

  useEffect(() => {
    fetch("/api/sermon/themes")
      .then((res) => res.json())
      .then((data) => {
        if (!Array.isArray(data.themes)) return;
        const themes = data.themes as SlideTheme[];
        setLoadedThemes(themes);
        // Default "midnight" (or an edited theme) may be missing from the
        // active catalog — coerce so save validation doesn't reject.
        setThemeId((current) => {
          if (themes.some((t) => t.id === current)) return current;
          const featured = themes.find((t) => t.featured);
          return featured?.id ?? themes[0]?.id ?? current;
        });
      })
      .catch(() => {
        // Preview falls back to bundled JSON themes
      });
  }, []);

  // Bring back unsaved work from this browser, once, on open.
  useEffect(() => {
    const draft = readLocalDraft(draftKey);
    if (!draft || !hasDraftContent(draft)) return;
    if (
      editSermon?.updatedAt &&
      new Date(draft.savedAt).getTime() < new Date(editSermon.updatedAt).getTime()
    ) {
      // Saved to FaithForm since this draft was kept; the server copy wins.
      clearLocalDraft(draftKey);
      return;
    }
    setTitle(draft.title);
    if (draft.sermonDate) setSermonDate(draft.sermonDate);
    if (draft.translation) setTranslation(draft.translation);
    if (draft.themeId) setThemeId(draft.themeId);
    setPassages(
      draft.passages.map((p) => ({ ...p, id: crypto.randomUUID(), bookId: "" })),
    );
    setChapter("");
    setVerseStart("");
    setVerseEnd("");
    setBookId("");
    if (draft.current?.book) {
      pendingBookRef.current = draft.current.book;
      pendingSelectionRef.current = draft.current;
      if (booksRef.current.length > 0) applyPendingBook(booksRef.current);
    } else {
      pendingBookRef.current = null;
    }
    setRestoredFrom(draft.savedAt);
    setDirty(true);
    // Runs once: later edits are the person's, not the stored draft's.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedTheme = useMemo(
    () => loadedThemes.find((t) => t.id === themeId) ?? null,
    [loadedThemes, themeId],
  );

  useEffect(() => {
    if (!translation || !bookId || !chapter) {
      setChapterVerses([]);
      setChapterBookName("");
      setMaxVerses(0);
      return;
    }

    let cancelled = false;
    setChapterLoading(true);
    setChapterError(false);

    fetchChapterAction(translation, bookId, Number(chapter))
      .then((data) => {
        if (cancelled) return;
        setChapterVerses(extractVersesFromChapter(data));
        setMaxVerses(data.numberOfVerses);
        setChapterBookName(data.book.commonName || data.book.name);
        setPreviewTranslation(
          data.translation.shortName ?? data.translation.name,
        );
      })
      .catch(() => {
        if (!cancelled) {
          setChapterVerses([]);
          setChapterBookName("");
          setMaxVerses(0);
          setChapterError(true);
        }
      })
      .finally(() => {
        if (!cancelled) setChapterLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [translation, bookId, chapter]);

  // Slicing is local, so typing a verse number updates the preview immediately.
  const previewVerses = useMemo(() => {
    if (chapterVerses.length === 0) return [];
    const start = verseStart === "" ? 1 : Number(verseStart);
    const end =
      verseEnd === ""
        ? verseStart === ""
          ? chapterVerses.length
          : start
        : Number(verseEnd);
    return sliceVerses(chapterVerses, start, end);
  }, [chapterVerses, verseStart, verseEnd]);

  // Feeds theme suggestions — they key off what the verses actually say.
  const previewText = useMemo(
    () => previewVerses.map((v) => v.plainText).join(" ").trim(),
    [previewVerses],
  );

  useEffect(() => {
    if (!chapterBookName || !chapter) {
      setPreviewRef("");
      return;
    }
    const start = verseStart === "" ? 1 : Number(verseStart);
    const end = verseEnd === "" ? start : Number(verseEnd);
    setPreviewRef(
      buildScriptureRef(chapterBookName, Number(chapter), start, end || start),
    );
  }, [chapterBookName, chapter, verseStart, verseEnd]);

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
  const draftRef = draftPassage
    ? buildScriptureRef(
        draftPassage.book,
        draftPassage.chapter,
        draftPassage.verseStart,
        draftPassage.verseEnd,
      )
    : null;
  const draftAlreadyListed = Boolean(
    draftPassage &&
      passages.some((p) => passageKey(p) === passageKey(draftPassage)),
  );

  const collectPassagesForSave = useCallback((): SimplePassageInput[] => {
    const saved: SimplePassageInput[] = passages.map((p) => ({
      book: p.book,
      chapter: p.chapter,
      verseStart: p.verseStart,
      verseEnd: p.verseEnd,
    }));

    if (!draftPassage) return saved;

    // The passage chosen in the picker is part of the deck without pressing
    // anything, unless it is already in the list.
    const draftKeyValue = passageKey(draftPassage);
    if (!saved.some((p) => passageKey(p) === draftKeyValue)) {
      saved.push(draftPassage);
    }

    return saved;
  }, [passages, draftPassage]);

  const totalPassageCount = collectPassagesForSave().length;

  const canSubmit = Boolean(
    title.trim() &&
      sermonDate &&
      enabledTranslation &&
      themeId &&
      totalPassageCount >= 1 &&
      totalPassageCount <= MAX_SIMPLE_PASSAGES,
  );

  const canAddPassage = Boolean(
    isDraftValid &&
      !draftAlreadyListed &&
      passages.length < MAX_SIMPLE_PASSAGES,
  );

  const missingFields: string[] = [];
  if (!title.trim()) missingFields.push("a title");
  if (!sermonDate) missingFields.push("a date");
  if (totalPassageCount < 1) missingFields.push("a Bible passage");
  const tooManyPassages = totalPassageCount > MAX_SIMPLE_PASSAGES;

  // Keep unsaved work in this browser as it is typed.
  useEffect(() => {
    if (!dirty || saving) return;
    const timer = setTimeout(() => {
      const kept = writeLocalDraft(draftKey, {
        title,
        sermonDate,
        translation,
        themeId,
        passages: passages.map(({ ref, book, chapter: ch, verseStart: vs, verseEnd: ve }) => ({
          ref,
          book,
          chapter: ch,
          verseStart: vs,
          verseEnd: ve,
        })),
        current: selectedBook
          ? {
              book: selectedBook.commonName || selectedBook.name,
              chapter,
              verseStart,
              verseEnd,
            }
          : null,
        savedAt: new Date().toISOString(),
      });
      setKeptLocally(kept);
    }, 600);
    return () => clearTimeout(timer);
  }, [
    dirty,
    saving,
    draftKey,
    title,
    sermonDate,
    translation,
    themeId,
    passages,
    selectedBook,
    chapter,
    verseStart,
    verseEnd,
  ]);

  // Leave-guard: closing the tab, reloading, or following a link in the
  // dashboard while there are unsaved changes asks first.
  useEffect(() => {
    if (!dirty || saving) return;

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };

    const onClick = async (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target as Element | null;
      const anchor = target?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!anchor || anchor.target === "_blank" || anchor.hasAttribute("download")) return;
      const url = new URL(anchor.href, window.location.href);
      if (url.origin !== window.location.origin) return;
      if (url.pathname === window.location.pathname && url.search === window.location.search) return;

      event.preventDefault();
      event.stopPropagation();
      const leave = await confirmAction({
        title: "Leave without saving?",
        description:
          "Your sermon isn't saved yet. We'll keep it on this computer, so it will be here when you come back.",
        confirmLabel: "Leave page",
        cancelLabel: "Keep editing",
      });
      if (leave) router.push(`${url.pathname}${url.search}${url.hash}`);
    };

    window.addEventListener("beforeunload", onBeforeUnload);
    document.addEventListener("click", onClick, true);
    return () => {
      window.removeEventListener("beforeunload", onBeforeUnload);
      document.removeEventListener("click", onClick, true);
    };
  }, [dirty, saving, router]);

  function handleAddPassage() {
    if (!canAddPassage || !draftPassage || !selectedBook || !draftRef) return;

    setPassages((prev) => [
      ...prev,
      {
        id: crypto.randomUUID(),
        ref: draftRef,
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
    touch();
  }

  function handleRemovePassage(id: string) {
    setPassages((prev) => prev.filter((p) => p.id !== id));
    touch();
  }

  function clearCurrentSelection() {
    setChapter("");
    setVerseStart("");
    setVerseEnd("");
    touch();
  }

  function startOver() {
    clearLocalDraft(draftKey);
    setDirty(false);
    window.location.reload();
  }

  async function handleSave() {
    if (!canSubmit) return;
    const allPassages = collectPassagesForSave();
    if (allPassages.length === 0) return;

    setSaving(true);
    setError(null);

    try {
      const payload = {
        title: title.trim(),
        translation,
        passages: allPassages,
        theme_id: themeId,
        sermon_date: sermonDate,
        ...(seriesId && !isEditing ? { series_id: seriesId } : {}),
      };

      const url = isEditing
        ? `/api/sermon/simple/${editSermon!.id}`
        : "/api/sermon/simple";
      const method = isEditing ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = (await res.json().catch(() => null)) as {
        error?: string;
        sermon?: { id?: string };
      } | null;
      const sermonId = isEditing ? editSermon!.id : data?.sermon?.id;
      if (!res.ok || !sermonId) {
        setError(typeof data?.error === "string" ? data.error : SAVE_FAILED);
        setSaving(false);
        return;
      }

      clearLocalDraft(draftKey);
      setDirty(false);
      toast.success(
        isEditing ? `Changes to "${payload.title}" saved.` : `"${payload.title}" saved.`,
      );
      router.push(`/dashboard/sermon-builder/${sermonId}`);
    } catch {
      setError(SAVE_FAILED);
      setSaving(false);
    }
  }

  const includedList: Array<{ key: string; ref: string; savedId?: string }> = [
    ...passages.map((p) => ({ key: p.id, ref: p.ref, savedId: p.id })),
    ...(draftRef && !draftAlreadyListed ? [{ key: "current", ref: draftRef }] : []),
  ];

  return (
    <div className="flex w-full flex-col gap-6">
      {restoredFrom && (
        <div
          role="status"
          className="flex flex-col gap-3 rounded-2xl border border-accent/40 bg-accent/10 px-5 py-4 sm:flex-row sm:items-center sm:justify-between"
        >
          <p className="text-[15px] text-foreground">
            We brought back the sermon you were working on. It isn&rsquo;t
            saved yet.
          </p>
          <Button type="button" variant="outline" onClick={startOver}>
            Start over
          </Button>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Sermon details</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="space-y-2">
            <Label htmlFor="deck-title">Sermon title</Label>
            <Input
              id="deck-title"
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                touch();
              }}
              placeholder="e.g. Sunday Morning — John 3"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="sermon-date">Sermon date</Label>
            <DatePicker
              id="sermon-date"
              value={sermonDate}
              onChange={(value) => {
                setSermonDate(value);
                touch();
              }}
            />
            <p className="text-sm text-muted-foreground">
              The Sunday you&rsquo;ll preach it. We picked the next one for you.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BookOpen aria-hidden className="size-6 text-accent" strokeWidth={1.75} />
            Bible passage
          </CardTitle>
          <p className="text-[15px] text-muted-foreground">
            Choose the book, chapter and verses. Each verse fills the screen as
            large as it fits.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-5">
          <div className="space-y-2">
            <Label htmlFor="translation">Bible translation</Label>
            <Select
              id="translation"
              value={translation}
              onChange={(e) => {
                const next = e.target.value;
                const option = translationOptions.find((t) => t.id === next);
                if (!option?.enabled) return;
                // Book IDs are shared across curated translations — keep
                // book/chapter/verse and saved passages when switching.
                setTranslation(next);
                touch();
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

          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div className="space-y-2 sm:col-span-2">
              <Label htmlFor="book">Book</Label>
              <Select
                id="book"
                value={bookId}
                onChange={(e) => {
                  setBookId(e.target.value);
                  setChapter("");
                  setVerseStart("");
                  setVerseEnd("");
                  touch();
                }}
                disabled={booksLoading || books.length === 0}
              >
                <option value="">
                  {booksLoading
                    ? "Loading…"
                    : booksError
                      ? "Couldn't load the books"
                      : "Choose a book"}
                </option>
                {books.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.commonName || b.name}
                  </option>
                ))}
              </Select>
              {booksError && (
                <p role="alert" className="text-sm text-destructive">
                  We couldn&rsquo;t load the books of the Bible. Check your
                  internet connection, then refresh the page.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="chapter">Chapter</Label>
              <Input
                id="chapter"
                type="number"
                inputMode="numeric"
                min={1}
                max={selectedBook?.numberOfChapters}
                value={chapter}
                onChange={(e) => {
                  setChapter(
                    clampNumber(
                      e.target.value,
                      1,
                      selectedBook?.numberOfChapters,
                    ),
                  );
                  setVerseStart("");
                  setVerseEnd("");
                  touch();
                }}
                disabled={!bookId}
                placeholder="—"
              />
              {selectedBook && (
                <p className="text-sm text-muted-foreground">
                  1 to {selectedBook.numberOfChapters}
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="verseStart">From verse</Label>
              <Input
                id="verseStart"
                type="number"
                inputMode="numeric"
                min={1}
                max={maxVerses || undefined}
                value={verseStart}
                onChange={(e) => {
                  const next = clampNumber(
                    e.target.value,
                    1,
                    maxVerses || undefined,
                  );
                  setVerseStart(next);
                  // Keep the range coherent rather than silently inverting it.
                  if (next !== "" && verseEnd !== "" && Number(verseEnd) < next) {
                    setVerseEnd(next);
                  }
                  touch();
                }}
                disabled={!chapter || maxVerses === 0}
                placeholder="1"
              />
            </div>

            <div className="space-y-2 lg:col-start-4">
              <Label htmlFor="verseEnd">To verse (optional)</Label>
              <Input
                id="verseEnd"
                type="number"
                inputMode="numeric"
                min={Number(verseStart) || 1}
                max={maxVerses || undefined}
                value={verseEnd}
                onChange={(e) => {
                  setVerseEnd(
                    clampNumber(
                      e.target.value,
                      Number(verseStart) || 1,
                      maxVerses || undefined,
                    ),
                  );
                  touch();
                }}
                disabled={!chapter || maxVerses === 0}
                placeholder="same"
              />
            </div>
          </div>

          <p className="min-h-[1.5rem] text-sm text-muted-foreground" aria-live="polite">
            {chapterLoading
              ? "Loading the chapter…"
              : maxVerses > 0
                ? `This chapter has ${maxVerses} verses. Leave "From verse" empty to use the whole chapter.`
                : ""}
          </p>

          {chapterError && (
            <p role="alert" className="text-sm text-destructive">
              We couldn&rsquo;t show a preview of this passage. You can still
              save; the verses load again when you open the slides.
            </p>
          )}

          <div className="space-y-3 rounded-2xl border border-border bg-muted/30 p-4">
            <p className="text-[15px] font-semibold text-foreground">
              Your slides will include
            </p>
            {includedList.length === 0 ? (
              <p className="text-[15px] text-muted-foreground">
                Nothing yet. Choose a book and chapter above; that passage is
                included automatically.
              </p>
            ) : (
              <ol className="flex flex-col gap-2">
                {includedList.map((item, index) => (
                  <li
                    key={item.key}
                    className="flex min-h-12 items-center justify-between gap-3 rounded-xl border border-border bg-card px-4 py-2 text-[15px]"
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <Check aria-hidden className="size-5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                      <span className="truncate">
                        <span className="text-muted-foreground">{index + 1}.</span>{" "}
                        <strong className="text-foreground">{item.ref}</strong>
                        {!item.savedId && (
                          <span className="text-muted-foreground"> (chosen above)</span>
                        )}
                      </span>
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-label={`Remove ${item.ref}`}
                      onClick={() =>
                        item.savedId ? handleRemovePassage(item.savedId) : clearCurrentSelection()
                      }
                    >
                      <X aria-hidden className="size-5" />
                      Remove
                    </Button>
                  </li>
                ))}
              </ol>
            )}
            <div className="flex flex-col items-start gap-2 pt-1">
              <Button
                type="button"
                variant="outline"
                disabled={!canAddPassage}
                onClick={handleAddPassage}
              >
                <Plus aria-hidden className="size-5" />
                Add another passage
              </Button>
              <p className="text-sm text-muted-foreground">
                {totalPassageCount >= MAX_SIMPLE_PASSAGES
                  ? `That's the most one deck can hold (${MAX_SIMPLE_PASSAGES} passages).`
                  : "Only need one passage? You're all set. Use this to add a second reading."}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Slide theme</CardTitle>
          <p className="text-[15px] text-muted-foreground">
            The background and colours of every slide.
          </p>
        </CardHeader>
        <CardContent>
          <ThemePicker
            selectedId={themeId}
            onSelect={(id) => {
              setThemeId(id);
              touch();
            }}
            onCoerce={setThemeId}
            context={{
              title: title.trim() || undefined,
              scripture: previewRef || undefined,
              scriptureText: previewText || undefined,
            }}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preview</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <SlidePreview
            themeId={themeId}
            theme={selectedTheme}
            verses={previewVerses}
            reference={previewRef}
            translation={previewTranslation}
          />
          <p className="text-sm text-muted-foreground">
            {totalPassageCount > 1
              ? `${totalPassageCount} passages in this sermon. The preview shows the one chosen above. `
              : ""}
            Long passages are split across slides so the words stay large.
          </p>
        </CardContent>
      </Card>

      {error && (
        <p
          role="alert"
          className="rounded-2xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-[15px] text-destructive"
        >
          {error}
        </p>
      )}

      <div className="flex flex-col items-start gap-2">
        <Button
          size="lg"
          className="w-full sm:w-auto"
          disabled={!canSubmit || saving}
          onClick={handleSave}
        >
          {saving ? (
            <>
              <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
              Saving…
            </>
          ) : (
            <>
              <Save aria-hidden className="size-5" />
              {isEditing ? "Save changes" : "Save sermon"}
            </>
          )}
        </Button>
        <p className="text-sm text-muted-foreground" role="status">
          {tooManyPassages
            ? `One sermon can hold up to ${MAX_SIMPLE_PASSAGES} passages. Remove one to save.`
            : !canSubmit && missingFields.length > 0
            ? `Add ${missingFields.join(" and ")} to save.`
            : dirty
              ? keptLocally
                ? "Not saved yet. Your work is kept on this computer until you save."
                : "Not saved yet."
              : isEditing
                ? "Saved. No changes yet."
                : "You can present, download or publish it after saving."}
        </p>
      </div>
    </div>
  );
}
