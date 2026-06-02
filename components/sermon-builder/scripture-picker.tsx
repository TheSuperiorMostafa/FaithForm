"use client";

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { ChevronDown, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { BIBLE_BOOKS, buildReference, findBook } from "@/lib/scripture/books";
import { cn } from "@/lib/utils";

type ScripturePickerProps = {
  value: string[];
  onChange: (refs: string[]) => void;
  onPreviewChange?: (ref: string) => void;
};

export type ScripturePickerHandle = {
  commitPending: () => string | null;
};

export const ScripturePicker = forwardRef<
  ScripturePickerHandle,
  ScripturePickerProps
>(function ScripturePicker(
  { value, onChange, onPreviewChange }: ScripturePickerProps,
  forwardedRef,
) {
  const [bookQuery, setBookQuery] = useState("");
  const [selectedBook, setSelectedBook] = useState<string>("");
  const [openBookList, setOpenBookList] = useState(false);
  const [chapter, setChapter] = useState<number | "">("");
  const [verseStart, setVerseStart] = useState<number | "">("");
  const [verseEnd, setVerseEnd] = useState<number | "">("");
  const containerRef = useRef<HTMLDivElement>(null);

  const book = useMemo(() => findBook(selectedBook), [selectedBook]);
  const chapterCount = book?.chapters ?? 0;

  const filteredBooks = useMemo(() => {
    const q = bookQuery.trim().toLowerCase();
    if (!q) return BIBLE_BOOKS;
    return BIBLE_BOOKS.filter((b) => b.name.toLowerCase().includes(q));
  }, [bookQuery]);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpenBookList(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function pickBook(name: string) {
    setSelectedBook(name);
    setBookQuery(name);
    setOpenBookList(false);
    setChapter("");
    setVerseStart("");
    setVerseEnd("");
  }

  function addReference(): string | null {
    if (!book || !chapter) return null;
    const ref = buildReference(
      book.name,
      Number(chapter),
      verseStart === "" ? null : Number(verseStart),
      verseEnd === "" ? null : Number(verseEnd),
    );
    if (!ref) return null;
    if (value.includes(ref)) {
      onPreviewChange?.(ref);
      return ref;
    }
    const next = [...value, ref];
    onChange(next);
    onPreviewChange?.(ref);
    setChapter("");
    setVerseStart("");
    setVerseEnd("");
    return ref;
  }

  function removeReference(ref: string) {
    onChange(value.filter((r) => r !== ref));
  }

  useImperativeHandle(forwardedRef, () => ({
    commitPending: () => addReference(),
  }));

  function onPickerKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      addReference();
    }
  }

  const canAdd = Boolean(book && chapter);

  return (
    <div
      className="flex flex-col gap-3"
      ref={containerRef}
      onKeyDown={onPickerKeyDown}
    >
      <div className="grid gap-3 sm:grid-cols-[2fr_1fr_1fr_1fr_auto]">
        <div className="relative">
          <Label htmlFor="book" className="mb-1.5 block">
            Book
          </Label>
          <div className="relative">
            <Input
              id="book"
              value={bookQuery}
              onChange={(e) => {
                setBookQuery(e.target.value);
                setOpenBookList(true);
                if (!findBook(e.target.value)) {
                  setSelectedBook("");
                }
              }}
              onFocus={() => setOpenBookList(true)}
              placeholder="Search a book…"
              autoComplete="off"
            />
            <ChevronDown className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" strokeWidth={1.75} />
          </div>
          {openBookList && filteredBooks.length > 0 && (
            <ul className="absolute z-30 mt-2 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-popover shadow-card">
              {filteredBooks.map((b) => (
                <li key={b.name}>
                  <button
                    type="button"
                    onClick={() => pickBook(b.name)}
                    className={cn(
                      "flex w-full items-center justify-between px-4 py-3 text-left text-sm hover:bg-accent/10",
                      selectedBook === b.name && "bg-accent/10 font-semibold text-primary dark:text-accent",
                    )}
                  >
                    <span>{b.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {b.testament} · {b.chapters} ch
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div>
          <Label htmlFor="chapter" className="mb-1.5 block">
            Chapter
          </Label>
          <Input
            id="chapter"
            type="number"
            min={1}
            max={chapterCount || undefined}
            value={chapter}
            onChange={(e) => {
              const n = e.target.value === "" ? "" : Number(e.target.value);
              if (typeof n === "number" && book && n > book.chapters) {
                setChapter(book.chapters);
              } else {
                setChapter(n);
              }
            }}
            disabled={!book}
            placeholder={book ? `1-${chapterCount}` : "—"}
          />
        </div>

        <div>
          <Label htmlFor="verseStart" className="mb-1.5 block">
            Verse
          </Label>
          <Input
            id="verseStart"
            type="number"
            min={1}
            value={verseStart}
            onChange={(e) =>
              setVerseStart(e.target.value === "" ? "" : Number(e.target.value))
            }
            disabled={!chapter}
            placeholder="opt."
          />
        </div>

        <div>
          <Label htmlFor="verseEnd" className="mb-1.5 block">
            To
          </Label>
          <Input
            id="verseEnd"
            type="number"
            min={Number(verseStart) || 1}
            value={verseEnd}
            onChange={(e) =>
              setVerseEnd(e.target.value === "" ? "" : Number(e.target.value))
            }
            disabled={!verseStart}
            placeholder="opt."
          />
        </div>

        <div className="flex items-end">
          <Button
            type="button"
            onClick={addReference}
            disabled={!canAdd}
            size="default"
            className="w-full sm:w-auto"
          >
            <Plus className="size-4" />
            Add
          </Button>
        </div>
      </div>

      {value.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {value.map((ref) => (
            <span
              key={ref}
              className="inline-flex items-center gap-1 rounded-full border border-accent/25 bg-accent/10 px-3 py-1 text-xs font-semibold"
            >
              <button
                type="button"
                onClick={() => onPreviewChange?.(ref)}
                className="font-semibold hover:text-accent"
              >
                {ref}
              </button>
              <button
                type="button"
                onClick={() => removeReference(ref)}
                aria-label={`Remove ${ref}`}
                className="text-muted-foreground hover:text-destructive"
              >
                <X className="size-3" strokeWidth={1.75} />
              </button>
            </span>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          Add one or more passages. They’ll be pulled into the outline, draft,
          and exports.
        </p>
      )}
    </div>
  );
});
