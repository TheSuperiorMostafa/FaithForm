"use client";

import * as React from "react";
import { Check, Search, X } from "lucide-react";

import { cn } from "@/lib/utils";

export type PickerItem = {
  id: string;
  label: string;
  /** Second line: household, phone, email, role… */
  description?: string;
  disabled?: boolean;
  disabledReason?: string;
};

function normalize(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[’'`]/g, "")
    .toLowerCase()
    .trim();
}

export function matchesQuery(item: PickerItem, query: string): boolean {
  const q = normalize(query);
  if (!q) return true;
  const haystack = normalize(`${item.label} ${item.description ?? ""}`);
  return q.split(/\s+/).every((part) => haystack.includes(part));
}

/**
 * Type-ahead picker for people, families, groups. Replaces native <select>
 * lists of the whole church. Chosen items stay visible as removable chips
 * even when the search changes (recognition over recall).
 *
 * Works inside a <form>: pass `name` and each chosen id is submitted as a
 * hidden input.
 */
export function SearchPicker({
  items,
  value,
  onChange,
  multiple = false,
  label,
  placeholder = "Start typing a name…",
  name,
  emptyText = "No one matches that name.",
  maxResults = 8,
  className,
  showAllWhenEmpty = false,
  autoFocus = false,
  required = false,
}: {
  items: PickerItem[];
  value: string[];
  onChange: (ids: string[]) => void;
  multiple?: boolean;
  label: string;
  placeholder?: string;
  name?: string;
  emptyText?: string;
  maxResults?: number;
  className?: string;
  /** Show the first results before anything is typed. */
  showAllWhenEmpty?: boolean;
  autoFocus?: boolean;
  required?: boolean;
}) {
  const [query, setQuery] = React.useState("");
  const [active, setActive] = React.useState(0);
  const inputId = React.useId();
  const listId = React.useId();

  const byId = React.useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const selected = value.map((id) => byId.get(id)).filter(Boolean) as PickerItem[];

  const matches = React.useMemo(() => {
    if (!query.trim() && !showAllWhenEmpty) return [];
    return items.filter((i) => matchesQuery(i, query));
  }, [items, query, showAllWhenEmpty]);
  const shown = matches.slice(0, maxResults);
  const hidden = matches.length - shown.length;

  React.useEffect(() => setActive(0), [query]);

  const toggle = (item: PickerItem) => {
    if (item.disabled) return;
    if (multiple) {
      onChange(value.includes(item.id) ? value.filter((v) => v !== item.id) : [...value, item.id]);
    } else {
      onChange(value.includes(item.id) ? [] : [item.id]);
      setQuery("");
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    // Enter in a search box picks a result; it never submits the whole form.
    if (e.key === "Enter") e.preventDefault();
    if (!shown.length) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((a) => Math.min(a + 1, shown.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = shown[active];
      if (item) toggle(item);
    }
  };

  const showList = shown.length > 0 || query.trim().length > 0;

  return (
    <div className={cn("space-y-3", className)}>
      <label htmlFor={inputId} className="block text-[15px] font-semibold text-foreground">
        {label}
      </label>

      {selected.length > 0 && (
        <ul className="flex flex-wrap gap-2" aria-label="Chosen">
          {selected.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => toggle(item)}
                className="inline-flex min-h-11 items-center gap-2 rounded-full bg-primary px-4 text-[15px] font-semibold text-primary-foreground transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                aria-label={`Remove ${item.label}`}
              >
                {item.label}
                <X className="size-4" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}

      {name &&
        value.map((id) => <input key={id} type="hidden" name={name} value={id} />)}
      {name && required && value.length === 0 && (
        // Lets the browser block an empty submit with a normal message.
        <input
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          required
          value=""
          onChange={() => undefined}
        />
      )}

      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-muted-foreground"
        />
        <input
          id={inputId}
          type="search"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={shown[active] ? `${listId}-${shown[active].id}` : undefined}
          value={query}
          autoFocus={autoFocus}
          autoComplete="off"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="min-h-12 w-full rounded-xl border-[1.5px] border-input bg-card pl-12 pr-4 text-base text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-accent focus:ring-2 focus:ring-accent/25"
        />
      </div>

      {showList && (
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          {shown.length === 0 ? (
            <p className="px-4 py-4 text-[15px] text-muted-foreground" role="status">
              {emptyText}
            </p>
          ) : (
            <ul id={listId} role="listbox" aria-multiselectable={multiple} className="divide-y divide-border">
              {shown.map((item, index) => {
                const isChosen = value.includes(item.id);
                return (
                  <li
                    key={item.id}
                    id={`${listId}-${item.id}`}
                    role="option"
                    aria-selected={isChosen}
                    aria-disabled={item.disabled || undefined}
                    onMouseEnter={() => setActive(index)}
                    onClick={() => toggle(item)}
                    className={cn(
                      "flex min-h-14 cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors",
                      index === active && "bg-accent/[0.08]",
                      item.disabled && "cursor-not-allowed opacity-60",
                    )}
                  >
                    <span
                      aria-hidden
                      className={cn(
                        "flex size-6 shrink-0 items-center justify-center rounded-md border-[1.5px]",
                        isChosen ? "border-primary bg-primary text-primary-foreground" : "border-input",
                      )}
                    >
                      {isChosen && <Check className="size-4" />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-base font-semibold text-foreground">
                        {item.label}
                      </span>
                      {(item.disabledReason || item.description) && (
                        <span className="block truncate text-sm text-muted-foreground">
                          {item.disabled ? item.disabledReason : item.description}
                        </span>
                      )}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {hidden > 0 && (
            <p className="border-t border-border px-4 py-3 text-sm text-muted-foreground">
              {hidden} more. Keep typing to narrow the list.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
