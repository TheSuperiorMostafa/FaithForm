"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { ThemePreview } from "@/components/sermon-builder/theme-preview";
import { ThemeUploadButton } from "@/components/sermon-builder/theme-upload-button";
import { AdvancedSection } from "@/components/ui/advanced-section";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getThemeFilterOptions,
  searchSlideThemes,
  UPLOADS_CATEGORY,
  type SlideTheme,
} from "@/lib/sermon-builder/slide-theme-shared";
import { cn } from "@/lib/utils";

type ThemePickerProps = {
  selectedId: string;
  onSelect: (id: string) => void;
  /**
   * Called when the picker swaps a theme that is no longer in the catalog
   * for a current one, which is not the person's choice. Defaults to onSelect.
   */
  onCoerce?: (id: string) => void;
  context?: {
    title?: string;
    scripture?: string;
    /** Literal text of the selected verses — drives the suggestions. */
    scriptureText?: string;
  };
};

type FilterPillsProps = {
  label: string;
  value: string;
  options: { id: string; count: number }[];
  onChange: (value: string) => void;
};

function FilterPills({ label, value, options, onChange }: FilterPillsProps) {
  if (options.length === 0) return null;

  const pill = (active: boolean) =>
    cn(
      "min-h-10 rounded-full border px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
      active
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border hover:border-primary/50",
    );

  return (
    <div role="group" aria-label={label} className="space-y-2">
      <p className="text-sm font-semibold text-foreground">{label}</p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          aria-pressed={value === "all"}
          onClick={() => onChange("all")}
          className={pill(value === "all")}
        >
          All
        </button>
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            aria-pressed={value === opt.id}
            onClick={() => onChange(opt.id)}
            className={cn(pill(value === opt.id), "capitalize")}
          >
            {opt.id.replace(/-/g, " ")} ({opt.count})
          </button>
        ))}
      </div>
    </div>
  );
}

/** How many themes the "Suggested" row shows before "More themes". */
const SUGGESTED_COUNT = 6;

export function ThemePicker({ selectedId, onSelect, onCoerce, context }: ThemePickerProps) {
  const [themes, setThemes] = useState<SlideTheme[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [category, setCategory] = useState("all");
  const [visualStyle, setVisualStyle] = useState("all");
  const [seasonal, setSeasonal] = useState("all");
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [suggestLoading, setSuggestLoading] = useState(false);

  const scriptureText = context?.scriptureText?.trim() ?? "";
  const contextRef = useRef(context);
  contextRef.current = context;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch("/api/sermon/themes")
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return;
        if (data.themes) {
          const nextThemes = data.themes as SlideTheme[];
          setThemes(nextThemes);
          if (
            nextThemes.length > 0 &&
            !nextThemes.some((t) => t.id === selectedId)
          ) {
            const featured = nextThemes.find((t) => t.featured);
            (onCoerce ?? onSelect)(featured?.id ?? nextThemes[0]!.id);
          }
        } else {
          setLoadError("We couldn't load the slide themes. Refresh the page to try again.");
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("We couldn't load the slide themes. Refresh the page to try again.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Only run on mount — parent coerces themeId after themes load as well.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filterOptions = useMemo(() => getThemeFilterOptions(themes), [themes]);

  const filtered = useMemo(
    () =>
      searchSlideThemes(themes, debouncedQuery, {
        category,
        visualStyle,
        seasonal,
      }),
    [themes, debouncedQuery, category, visualStyle, seasonal],
  );

  const suggestedThemes = useMemo(
    () =>
      suggestions
        .map((id) => themes.find((t) => t.id === id))
        .filter((t): t is SlideTheme => Boolean(t)),
    [suggestions, themes],
  );

  const fetchSuggestions = useCallback(async (refresh = false) => {
    setSuggestLoading(true);
    try {
      const res = await fetch("/api/sermon/themes/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ context: contextRef.current, refresh }),
      });
      const data = await res.json();
      if (res.ok && Array.isArray(data.suggestions)) {
        setSuggestions(data.suggestions);
      }
    } catch {
      // Suggestions are optional — ignore failures
    } finally {
      setSuggestLoading(false);
    }
  }, []);

  // Re-suggest whenever the chosen passage changes. Debounced so scrolling
  // through verse numbers doesn't fire a request per keystroke.
  useEffect(() => {
    if (!scriptureText) {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => void fetchSuggestions(), 600);
    return () => clearTimeout(timer);
  }, [scriptureText, fetchSuggestions]);

  function handleSelect(id: string) {
    onSelect(id);
  }

  // Suggested first: themes matched to the passage, then featured ones, and
  // always the one already chosen so it never hides behind "More themes".
  const suggestedRow = useMemo(() => {
    const row: SlideTheme[] = [];
    const add = (theme: SlideTheme | undefined) => {
      if (theme && !row.some((t) => t.id === theme.id)) row.push(theme);
    };
    add(themes.find((t) => t.id === selectedId));
    suggestedThemes.forEach(add);
    themes.filter((t) => t.featured).forEach(add);
    themes.forEach((t) => {
      if (row.length < SUGGESTED_COUNT) add(t);
    });
    return row.slice(0, SUGGESTED_COUNT);
  }, [themes, suggestedThemes, selectedId]);

  const selectedTheme = themes.find((t) => t.id === selectedId);
  const moreOpen =
    Boolean(debouncedQuery) ||
    category !== "all" ||
    visualStyle !== "all" ||
    seasonal !== "all";

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-[15px] text-muted-foreground">
        <Loader2 aria-hidden className="mr-2 size-5 animate-spin motion-reduce:animate-none" />
        Loading themes…
      </div>
    );
  }

  if (loadError) {
    return (
      <p role="alert" className="py-8 text-center text-[15px] text-destructive">
        {loadError}
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <div className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-2 text-base font-semibold text-foreground">
              <Sparkles aria-hidden className="size-5 text-accent" />
              Suggested
            </p>
            <p className="text-[15px] text-muted-foreground">
              {suggestedThemes.length > 0
                ? `Matched to the imagery in ${context?.scripture || "your passage"}.`
                : suggestLoading
                  ? "Reading your passage to suggest a theme…"
                  : "Popular themes. Choose a passage and we'll suggest ones that fit it."}
            </p>
          </div>
          {scriptureText && (
            <Button
              type="button"
              variant="ghost"
              disabled={suggestLoading}
              onClick={() => fetchSuggestions(true)}
            >
              {suggestLoading ? (
                <Loader2 aria-hidden className="size-5 animate-spin motion-reduce:animate-none" />
              ) : (
                <RefreshCw aria-hidden className="size-5" />
              )}
              Suggest others
            </Button>
          )}
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {suggestedRow.map((theme) => (
            <ThemePreview
              key={theme.id}
              theme={theme}
              selected={selectedId === theme.id}
              onSelect={() => handleSelect(theme.id)}
            />
          ))}
        </div>
        {selectedTheme && (
          <p className="text-[15px] text-muted-foreground" role="status">
            Chosen: <strong className="text-foreground">{selectedTheme.name}</strong>
          </p>
        )}
      </div>

      <AdvancedSection
        title="More themes"
        description="Search every theme, filter by style or season, or upload your own photo."
        forceOpen={moreOpen}
      >
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
          <div className="relative flex-1">
            <Search aria-hidden className="absolute left-3 top-1/2 size-5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by theme, season, symbol, or style"
              aria-label="Search themes"
              className="pl-10"
            />
          </div>
          <ThemeUploadButton
            onUploaded={(theme) => {
              // Show it immediately and select it — that's why they uploaded it.
              setThemes((prev) => [theme, ...prev.filter((t) => t.id !== theme.id)]);
              setCategory(UPLOADS_CATEGORY);
              onSelect(theme.id);
            }}
          />
        </div>

        <div className="space-y-4">
          <FilterPills
            label="Category"
            value={category}
            options={filterOptions.categories}
            onChange={setCategory}
          />
          <FilterPills
            label="Look"
            value={visualStyle}
            options={filterOptions.visualStyles}
            onChange={setVisualStyle}
          />
          <FilterPills
            label="Season"
            value={seasonal}
            options={filterOptions.seasonal}
            onChange={setSeasonal}
          />
        </div>

        <div className="max-h-[560px] overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <p className="py-8 text-center text-[15px] text-muted-foreground">
              No themes match. Try a different word, or choose All.
            </p>
          ) : (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {filtered.map((theme) => (
                <ThemePreview
                  key={theme.id}
                  theme={theme}
                  selected={selectedId === theme.id}
                  onSelect={() => handleSelect(theme.id)}
                />
              ))}
            </div>
          )}
        </div>
      </AdvancedSection>
    </div>
  );
}
