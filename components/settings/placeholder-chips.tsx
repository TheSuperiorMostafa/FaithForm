"use client";

import { Plus } from "lucide-react";

export type PlaceholderChip = {
  /** Exactly what goes in the text, e.g. "[Name]". */
  token: string;
  /** What FaithForm puts there when the message goes out. */
  meaning: string;
};

/**
 * Drops `token` into the input or textarea with `targetId` at the cursor and
 * returns the field's new value (null when the field can't be edited).
 */
export function insertPlaceholder(targetId: string, token: string): string | null {
  const field = document.getElementById(targetId) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!field || field.disabled) return null;
  const start = field.selectionStart ?? field.value.length;
  const end = field.selectionEnd ?? field.value.length;
  const next = `${field.value.slice(0, start)}${token}${field.value.slice(end)}`;
  // Uncontrolled fields: set the value the browser way so React and the
  // form both see it.
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(field), "value")?.set;
  setter?.call(field, next);
  field.dispatchEvent(new Event("input", { bubbles: true }));
  field.focus();
  const caret = start + token.length;
  field.setSelectionRange(caret, caret);
  return next;
}

/**
 * Placeholders shown as friendly chips instead of syntax to memorise. Each
 * chip says what it turns into, and tapping it drops it into the box at the
 * cursor. The text itself is unchanged, so saving works exactly as before.
 */
export function PlaceholderChips({
  chips,
  targetId,
  onInsert,
  label = "Tap to add",
}: {
  chips: PlaceholderChip[];
  /** The id of the input or textarea the chip is inserted into. */
  targetId: string;
  /** Called after inserting, with the field's new value. */
  onInsert?: (value: string) => void;
  label?: string;
}) {
  const insert = (token: string) => {
    const next = insertPlaceholder(targetId, token);
    if (next !== null) onInsert?.(next);
  };

  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">{label}</p>
      <ul className="flex flex-wrap gap-2">
        {chips.map((chip) => (
          <li key={chip.token}>
            <button
              type="button"
              onClick={() => insert(chip.token)}
              className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border bg-background px-4 text-sm transition-colors hover:border-accent hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
            >
              <Plus className="size-4 text-accent" aria-hidden />
              <span className="font-semibold text-foreground">{chip.meaning}</span>
              <span className="font-mono text-muted-foreground">{chip.token}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
