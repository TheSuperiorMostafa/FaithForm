"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2, RefreshCw, Search, Sparkles } from "lucide-react";
import { ThemePreview } from "@/components/sermon-builder/theme-preview";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  getThemeFilterOptions,
  searchSlideThemes,
  type SlideTheme,
} from "@/lib/sermon-builder/slide-theme-shared";
import { cn } from "@/lib/utils";

type ThemePickerProps = {
  selectedId: string;
  onSelect: (id: string) => void;
  context?: {
    title?: string;
    scripture?: string;
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

  return (
    <div className="space-y-1.5">
      <p className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange("all")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            value === "all"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border hover:border-primary/50",
          )}
        >
          All
        </button>
        {options.map((opt) => (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium capitalize transition-colors",
              value === opt.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:border-primary/50",
            )}
          >
            {opt.id.replace(/-/g, " ")} ({opt.count})
          </button>
        ))}
      </div>
    </div>
  );
}

export function ThemePicker({ selectedId, onSelect, context }: ThemePickerProps) {
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
  const [hasSelectedOnce, setHasSelectedOnce] = useState(false);

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
            onSelect(featured?.id ?? nextThemes[0]!.id);
          }
        } else {
          setLoadError(data.error ?? "Could not load themes");
        }
      })
      .catch(() => {
        if (!cancelled) setLoadError("Could not load themes");
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

  const showFeatured =
    !debouncedQuery &&
    category === "all" &&
    visualStyle === "all" &&
    seasonal === "all";
  const featured = useMemo(
    () => filtered.filter((t) => t.featured),
    [filtered],
  );
  const featuredIds = new Set(featured.map((t) => t.id));
  const nonFeaturedFiltered = showFeatured
    ? filtered.filter((t) => !featuredIds.has(t.id))
    : filtered;

  const suggestedThemes = useMemo(
    () =>
      suggestions
        .map((id) => themes.find((t) => t.id === id))
        .filter((t): t is SlideTheme => Boolean(t)),
    [suggestions, themes],
  );

  async function fetchSuggestions(themeId: string, refresh = false) {
    setSuggestLoading(true);
    try {
      const res = await fetch("/api/sermon/themes/suggest", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          selectedThemeId: themeId,
          context,
          refresh,
        }),
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
  }

  function handleSelect(id: string) {
    onSelect(id);
    if (!hasSelectedOnce) {
      setHasSelectedOnce(true);
    }
    void fetchSuggestions(id);
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        <Loader2 className="mr-2 size-4 animate-spin" />
        Loading themes…
      </div>
    );
  }

  if (loadError) {
    return (
      <p className="py-8 text-center text-sm text-destructive">{loadError}</p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search by theme, season, symbol, or style…"
          className="pl-9"
        />
      </div>

      <div className="space-y-3">
        <FilterPills
          label="Category"
          value={category}
          options={filterOptions.categories}
          onChange={setCategory}
        />
        <FilterPills
          label="Visual style"
          value={visualStyle}
          options={filterOptions.visualStyles}
          onChange={setVisualStyle}
        />
        <FilterPills
          label="Seasonal"
          value={seasonal}
          options={filterOptions.seasonal}
          onChange={setSeasonal}
        />
      </div>

      {hasSelectedOnce && selectedId && (
        <div className="space-y-2 rounded-xl border border-border bg-muted/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <p className="flex items-center gap-1.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">
              <Sparkles className="size-3.5" />
              Suggested for you
            </p>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-xs"
              disabled={suggestLoading}
              onClick={() => fetchSuggestions(selectedId, true)}
            >
              {suggestLoading ? (
                <Loader2 className="size-3 animate-spin" />
              ) : (
                <RefreshCw className="size-3" />
              )}
              More like this
            </Button>
          </div>
          {suggestLoading && suggestedThemes.length === 0 ? (
            <p className="text-xs text-muted-foreground">Finding similar themes…</p>
          ) : suggestedThemes.length > 0 ? (
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {suggestedThemes.map((theme) => (
                <ThemePreview
                  key={theme.id}
                  theme={theme}
                  selected={selectedId === theme.id}
                  onSelect={() => handleSelect(theme.id)}
                  compact
                />
              ))}
            </div>
          ) : (
            <p className="text-xs text-muted-foreground">
              Select a theme to see suggestions.
            </p>
          )}
        </div>
      )}

      <div className="max-h-[520px] space-y-4 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No themes match your search. Try a different keyword or filter.
          </p>
        ) : (
          <>
            {showFeatured && featured.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Featured
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {featured.map((theme) => (
                    <ThemePreview
                      key={theme.id}
                      theme={theme}
                      selected={selectedId === theme.id}
                      onSelect={() => handleSelect(theme.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {nonFeaturedFiltered.length > 0 && (
              <div className="space-y-2">
                {showFeatured && (
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    All themes ({nonFeaturedFiltered.length})
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                  {nonFeaturedFiltered.map((theme) => (
                    <ThemePreview
                      key={theme.id}
                      theme={theme}
                      selected={selectedId === theme.id}
                      onSelect={() => handleSelect(theme.id)}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
