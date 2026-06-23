"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { normalizeTag, normalizeTagList } from "@/lib/sermon-builder/theme-taxonomy";
import { cn } from "@/lib/utils";

type TagEditorProps = {
  id?: string;
  label: string;
  value: string[];
  onChange: (tags: string[]) => void;
  suggestions?: string[];
  placeholder?: string;
};

export function TagEditor({
  id,
  label,
  value,
  onChange,
  suggestions = [],
  placeholder = "Type a tag and press Enter",
}: TagEditorProps) {
  const [input, setInput] = useState("");
  const [showSuggestions, setShowSuggestions] = useState(false);

  const filteredSuggestions = useMemo(() => {
    const query = input.trim().toLowerCase();
    if (!query) return suggestions.filter((tag) => !value.includes(tag)).slice(0, 8);
    return suggestions
      .filter((tag) => !value.includes(tag) && tag.includes(query))
      .slice(0, 8);
  }, [input, suggestions, value]);

  function addTags(raw: string) {
    const next = normalizeTagList([...value, raw]);
    onChange(next);
    setInput("");
    setShowSuggestions(false);
  }

  function removeTag(tag: string) {
    onChange(value.filter((item) => item !== tag));
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault();
      const tag = normalizeTag(input);
      if (tag) addTags(tag);
      return;
    }

    if (event.key === "Backspace" && !input && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>) {
    const text = event.clipboardData.getData("text");
    if (!text.includes(",")) return;
    event.preventDefault();
    addTags(text);
  }

  return (
    <div className="space-y-2">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      <div
        className={cn(
          "flex min-h-10 flex-wrap items-center gap-2 rounded-lg border border-border bg-background px-2 py-2",
          "focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20",
        )}
      >
        {value.map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-medium text-foreground"
          >
            {tag}
            <button
              type="button"
              onClick={() => removeTag(tag)}
              className="rounded-full text-muted-foreground hover:text-foreground"
              aria-label={`Remove ${tag}`}
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <div className="relative min-w-[140px] flex-1">
          <input
            id={id}
            value={input}
            onChange={(event) => {
              setInput(event.target.value);
              setShowSuggestions(true);
            }}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            onFocus={() => setShowSuggestions(true)}
            onBlur={() => {
              window.setTimeout(() => setShowSuggestions(false), 120);
            }}
            placeholder={value.length === 0 ? placeholder : "Add another…"}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
          {showSuggestions && filteredSuggestions.length > 0 && (
            <ul className="absolute left-0 right-0 top-full z-20 mt-1 max-h-40 overflow-y-auto rounded-lg border border-border bg-card py-1 shadow-card">
              {filteredSuggestions.map((tag) => (
                <li key={tag}>
                  <button
                    type="button"
                    className="w-full px-3 py-2 text-left text-sm hover:bg-accent/10"
                    onMouseDown={(event) => {
                      event.preventDefault();
                      addTags(tag);
                    }}
                  >
                    {tag}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        Press Enter or comma to add. Paste comma-separated lists. Max 12 tags.
      </p>
    </div>
  );
}
