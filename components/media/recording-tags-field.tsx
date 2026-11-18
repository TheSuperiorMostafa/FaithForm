"use client";

import { useId, useMemo, useRef, useState } from "react";
import { Plus, X } from "lucide-react";
import { Input } from "@/components/ui/input";

/** Kept local so this field has no dependencies beyond React and the UI kit. */
function cn(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

export type RecordingTagsValue = { items: string[]; draft: string };

export function createRecordingTagsValue(items: string[] = []): RecordingTagsValue {
  return { items: [...items], draft: "" };
}

/** A pending entry is still a field value when Save is pressed or options fold. */
export function recordingTagItems(value: RecordingTagsValue): string[] {
  return [...new Set([...value.items, value.draft].map(item => item.trim()).filter(Boolean))];
}

export const MAX_TAG_ITEMS = 20;
const MAX_ITEMS = MAX_TAG_ITEMS;

export function TagChips({ label, value, onChange }: { label: string; value: RecordingTagsValue; onChange: (value: RecordingTagsValue) => void }) {
  if (value.items.length === 0) return null;
  return <ul aria-label={`${label} added`} className="flex min-w-0 flex-wrap gap-2">
    {value.items.map((item, index) => <li key={`${index}:${item}`} className="flex min-w-0 max-w-full items-center gap-1 rounded-full border border-border bg-muted/50 py-0.5 pl-3 pr-0.5">
      <span className="min-w-0 break-words text-[15px] font-medium">{item}</span>
      <button type="button" className="flex size-11 min-h-11 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Remove ${item}`}
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
    {TagChips({ label, value, onChange: next => { onChange(next); setError(null); } })}
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
