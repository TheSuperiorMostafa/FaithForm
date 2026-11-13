"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export type RecordingTagsValue = { items: string[]; draft: string };

export function createRecordingTagsValue(items: string[] = []): RecordingTagsValue {
  return { items: [...items], draft: "" };
}

/** A pending entry is still a field value when Save is pressed or options fold. */
export function recordingTagItems(value: RecordingTagsValue): string[] {
  return [...new Set([...value.items, value.draft].map(item => item.trim()).filter(Boolean))];
}

export function RecordingTagsField({ id, name, label, addLabel, value, onChange, placeholder, maxLength = 80 }: {
  id: string; name: string; label: string; value: RecordingTagsValue;
  addLabel: string; onChange: (value: RecordingTagsValue) => void; placeholder: string; maxLength?: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  function add() {
    const items = recordingTagItems(value);
    if (!value.draft.trim()) return;
    if (items.length > 20 || value.draft.trim().length > maxLength) {
      setError(`Use up to 20 entries, each ${maxLength} characters or fewer.`);
      return;
    }
    onChange({ items, draft: "" });
    setError(null);
  }
  return <div className="flex min-w-0 flex-col gap-2">
    {value.items.length > 0 ? <ul aria-label={`${label} added`} className="flex min-w-0 flex-wrap gap-2">
      {value.items.map((item, index) => <li key={`${index}:${item}`} className="flex min-w-0 max-w-full items-center gap-1 rounded-xl border border-border bg-muted/50 pl-3">
        <span className="min-w-0 break-words text-[15px]">{item}</span>
        <Button type="button" variant="ghost" className="min-h-11 shrink-0 px-3 text-sm" aria-label={`Remove ${item}`} onClick={() => {
          onChange({ ...value, items: value.items.filter((_, itemIndex) => itemIndex !== index) });
          setError(null);
        }}>Remove</Button>
      </li>)}
    </ul> : null}
    <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
      <Input id={id} name={`${name}_draft`} value={value.draft} placeholder={placeholder} maxLength={maxLength} autoComplete="off"
        className="min-w-0 flex-1" disabled={value.items.length >= 20}
        aria-describedby={error ? `${helpId} ${errorId}` : helpId} aria-invalid={error ? true : undefined}
        onChange={event => { onChange({ ...value, draft: event.target.value }); setError(null); }}
        onKeyDown={event => {
          if (event.key !== "Enter" || event.nativeEvent.isComposing || event.keyCode === 229) return;
          event.preventDefault();
          add();
        }} />
      <Button type="button" variant="outline" className="shrink-0" disabled={!value.draft.trim()} onClick={add}>{addLabel}</Button>
    </div>
    <input type="hidden" name={`${name}_json`} value={JSON.stringify(recordingTagItems(value))} />
    <p id={helpId} className="text-sm text-muted-foreground">Type one entry and press Enter to add it. Up to 20 entries.</p>
    {error ? <p id={errorId} role="alert" className="text-sm text-destructive">{error}</p> : null}
  </div>;
}
