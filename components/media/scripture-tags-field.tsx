"use client";

import { useState } from "react";
import { ChevronLeft, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MAX_TAG_ITEMS, recordingTagItems, TagChips, type RecordingTagsValue } from "@/components/media/recording-tags-field";
import { BIBLE_BOOKS } from "@/lib/scripture/books";
import { verseCount } from "@/lib/scripture/verse-counts";
import { cn } from "@/lib/utils";

const MAX_ITEMS = MAX_TAG_ITEMS;

/**
 * Scripture: pick the book, then the chapter, then the verses. Each pick adds
 * one reference such as "Romans 8:1-14", or the whole chapter.
 */
export function ScriptureTagsField({ id, name, label, value, onChange }: {
  id: string; name: string; label: string; value: RecordingTagsValue; onChange: (value: RecordingTagsValue) => void;
}) {
  const [open, setOpen] = useState(false);
  const [book, setBook] = useState<string | null>(null);
  const [chapter, setChapter] = useState<number | null>(null);
  const [start, setStart] = useState<number | null>(null);
  const [filter, setFilter] = useState("");
  const [error, setError] = useState<string | null>(null);
  const full = value.items.length >= MAX_ITEMS;

  function reset() { setBook(null); setChapter(null); setStart(null); setFilter(""); }
  function add(reference: string) {
    if (full) { setError(`Use up to ${MAX_ITEMS} references.`); return; }
    if (!value.items.some(item => item.toLowerCase() === reference.toLowerCase())) {
      onChange({ items: [...value.items, reference], draft: "" });
    }
    setError(null);
    reset();
    setOpen(false);
  }

  const chapters = book ? BIBLE_BOOKS.find(entry => entry.name === book)?.chapters ?? 0 : 0;
  const verses = book && chapter ? verseCount(book, chapter) : 0;
  const books = BIBLE_BOOKS.filter(entry => !filter.trim() || entry.name.toLowerCase().includes(filter.trim().toLowerCase()));

  const step = !book ? "Book" : !chapter ? `${book} — chapter` : start ? `${book} ${chapter}:${start} — last verse` : `${book} ${chapter} — verses`;

  return <div className="flex min-w-0 flex-col gap-2">
    {TagChips({ label, value, onChange: next => { onChange(next); setError(null); } })}
    <input type="hidden" name={`${name}_json`} value={JSON.stringify(recordingTagItems(value))} />
    {!open ? <Button id={id} type="button" variant="outline" className="self-start" disabled={full} onClick={() => { reset(); setOpen(true); }}>
      <Plus className="size-4" aria-hidden />Add Scripture
    </Button> : <div className="flex min-w-0 flex-col gap-3 rounded-2xl border border-border bg-background p-3 shadow-sm" role="group" aria-label="Choose Scripture">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1">
          {book ? <Button type="button" variant="ghost" size="icon-sm" aria-label="Back" onClick={() => {
            if (start) setStart(null); else if (chapter) setChapter(null); else setBook(null);
          }}><ChevronLeft className="size-4" aria-hidden /></Button> : null}
          <p className="truncate text-[15px] font-semibold" aria-live="polite">{step}</p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={() => { reset(); setOpen(false); }}>Close</Button>
      </div>

      {!book ? <>
        <Input autoFocus value={filter} onChange={event => setFilter(event.target.value)} placeholder="Find a book" aria-label="Find a book" autoComplete="off" />
        <ul className="grid max-h-72 grid-cols-2 gap-1 overflow-y-auto sm:grid-cols-3" aria-label="Books">
          {books.map(entry => <li key={entry.name}>
            <button type="button" onClick={() => { setBook(entry.name); setFilter(""); }}
              className="flex min-h-11 w-full items-center rounded-lg px-3 text-left text-[15px] hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
              {entry.name}
            </button>
          </li>)}
        </ul>
      </> : !chapter ? <ul className="grid max-h-72 grid-cols-6 gap-1 overflow-y-auto sm:grid-cols-8" aria-label={`${book} chapters`}>
        {Array.from({ length: chapters }, (_, index) => index + 1).map(number => <li key={number}>
          <button type="button" onClick={() => setChapter(number)} aria-label={`Chapter ${number}`}
            className="flex aspect-square w-full items-center justify-center rounded-lg text-[15px] tabular-nums hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {number}
          </button>
        </li>)}
      </ul> : <>
        <p className="text-sm text-muted-foreground">
          {start ? "Choose the last verse, or add just this one." : "Choose the first verse, or add the whole chapter."}
        </p>
        <ul className="grid max-h-72 grid-cols-6 gap-1 overflow-y-auto sm:grid-cols-8" aria-label={`${book} ${chapter} verses`}>
          {Array.from({ length: verses }, (_, index) => index + 1).map(number => {
            const disabled = start !== null && number < start;
            return <li key={number}>
              <button type="button" disabled={disabled} aria-label={`Verse ${number}`}
                onClick={() => {
                  if (start === null) { setStart(number); return; }
                  add(number === start ? `${book} ${chapter}:${start}` : `${book} ${chapter}:${start}-${number}`);
                }}
                className={cn("flex aspect-square w-full items-center justify-center rounded-lg text-[15px] tabular-nums hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-30",
                  start === number && "bg-accent font-semibold text-accent-foreground hover:bg-accent")}>
                {number}
              </button>
            </li>;
          })}
        </ul>
        <div className="flex flex-wrap gap-2">
          {start ? <Button type="button" onClick={() => add(`${book} ${chapter}:${start}`)}>Add {book} {chapter}:{start}</Button>
            : <Button type="button" variant="outline" onClick={() => add(`${book} ${chapter}`)}>Add all of {book} {chapter}</Button>}
        </div>
      </>}
    </div>}
    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>;
}
