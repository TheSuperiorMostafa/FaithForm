"use client";

import { useId, useMemo, useRef, useState } from "react";
import { ChevronLeft, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { BIBLE_BOOKS } from "@/lib/scripture/books";
import { verseCount } from "@/lib/scripture/verse-counts";
import { cn } from "@/lib/utils";

export type RecordingTagsValue = { items: string[]; draft: string };

export function createRecordingTagsValue(items: string[] = []): RecordingTagsValue {
  return { items: [...items], draft: "" };
}

/** A pending entry is still a field value when Save is pressed or options fold. */
export function recordingTagItems(value: RecordingTagsValue): string[] {
  return [...new Set([...value.items, value.draft].map(item => item.trim()).filter(Boolean))];
}

const MAX_ITEMS = 20;

function Chips({ label, value, onChange }: { label: string; value: RecordingTagsValue; onChange: (value: RecordingTagsValue) => void }) {
  if (value.items.length === 0) return null;
  return <ul aria-label={`${label} added`} className="flex min-w-0 flex-wrap gap-2">
    {value.items.map((item, index) => <li key={`${index}:${item}`} className="flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border bg-muted/50 py-0.5 pl-3 pr-0.5">
      <span className="min-w-0 break-words text-[15px] font-medium">{item}</span>
      <button type="button" className="flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Remove ${item}`}
        onClick={() => onChange({ ...value, items: value.items.filter((_, itemIndex) => itemIndex !== index) })}>
        <X className="size-4" aria-hidden />
      </button>
    </li>)}
  </ul>;
}

/**
 * Speakers and topics: a list to choose from — everything this church has
 * used before — with the typed name offered as a new entry at the top.
 */
export function RecordingTagsField({ id, name, label, addLabel, value, onChange, placeholder, maxLength = 80, suggestions = [] }: {
  id: string; name: string; label: string; value: RecordingTagsValue;
  addLabel: string; onChange: (value: RecordingTagsValue) => void; placeholder: string; maxLength?: number;
  /** Earlier entries to choose from. */
  suggestions?: string[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const listId = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const chosen = new Set(value.items.map(item => item.toLowerCase()));
  const query = value.draft.trim();
  const options = useMemo(() => {
    const lower = query.toLowerCase();
    const matches = suggestions.filter(item => !chosen.has(item.toLowerCase()) && (!lower || item.toLowerCase().includes(lower)));
    const exact = suggestions.some(item => item.toLowerCase() === lower) || chosen.has(lower);
    return [...(query && !exact ? [{ label: query, isNew: true }] : []), ...matches.slice(0, 50).map(label => ({ label, isNew: false }))];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, suggestions, value.items]);

  function addItem(entry: string) {
    const text = entry.trim();
    if (!text) return;
    if (value.items.length >= MAX_ITEMS || text.length > maxLength) {
      setError(`Use up to ${MAX_ITEMS} entries, each ${maxLength} characters or fewer.`);
      return;
    }
    if (!chosen.has(text.toLowerCase())) onChange({ items: [...value.items, text], draft: "" });
    else onChange({ ...value, draft: "" });
    setError(null);
    setActive(0);
  }

  const full = value.items.length >= MAX_ITEMS;
  const showList = open && !full && options.length > 0;

  return <div className="flex min-w-0 flex-col gap-2">
    <Chips label={label} value={value} onChange={next => { onChange(next); setError(null); }} />
    <div className="relative min-w-0">
      <Input id={id} name={`${name}_draft`} value={value.draft} placeholder={full ? `${MAX_ITEMS} added` : placeholder} maxLength={maxLength} autoComplete="off"
        role="combobox" aria-expanded={showList} aria-controls={listId} aria-autocomplete="list"
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        className="min-w-0" disabled={full}
        aria-describedby={error ? `${helpId} ${errorId}` : helpId} aria-invalid={error ? true : undefined}
        onFocus={() => { if (blurTimer.current) clearTimeout(blurTimer.current); setOpen(true); }}
        onBlur={() => { blurTimer.current = setTimeout(() => setOpen(false), 150); }}
        onChange={event => { onChange({ ...value, draft: event.target.value }); setError(null); setOpen(true); setActive(0); }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) return;
          if (event.key === "ArrowDown") { event.preventDefault(); setOpen(true); setActive(index => Math.min(index + 1, options.length - 1)); return; }
          if (event.key === "ArrowUp") { event.preventDefault(); setActive(index => Math.max(index - 1, 0)); return; }
          if (event.key === "Escape") { setOpen(false); return; }
          if (event.key !== "Enter") return;
          event.preventDefault();
          if (showList && options[active]) addItem(options[active].label);
          else addItem(value.draft);
        }} />
      {showList ? <ul id={listId} role="listbox" aria-label={label}
        className="absolute inset-x-0 top-full z-40 mt-1 max-h-64 overflow-y-auto rounded-xl border border-border bg-background p-1 shadow-lg">
        {options.map((option, index) => <li key={`${option.isNew ? "new" : "old"}:${option.label}`} id={`${listId}-${index}`} role="option" aria-selected={index === active}
          onMouseDown={event => event.preventDefault()}
          onMouseEnter={() => setActive(index)}
          onClick={() => addItem(option.label)}
          className={cn("flex min-h-11 cursor-pointer items-center gap-2 rounded-lg px-3 text-[15px]", index === active ? "bg-accent/15" : "hover:bg-accent/10")}>
          {option.isNew ? <><Plus className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="min-w-0 break-words">{addLabel} “{option.label}”</span></> : <span className="min-w-0 break-words">{option.label}</span>}
        </li>)}
      </ul> : null}
    </div>
    <input type="hidden" name={`${name}_json`} value={JSON.stringify(recordingTagItems(value))} />
    <p id={helpId} className="text-sm text-muted-foreground">
      {suggestions.length ? "Choose from the list, or type a new one and add it." : "Type a name and add it."} Up to {MAX_ITEMS}.
    </p>
    {error ? <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>;
}

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
    <Chips label={label} value={value} onChange={next => { onChange(next); setError(null); }} />
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
