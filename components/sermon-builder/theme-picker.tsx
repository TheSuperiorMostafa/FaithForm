"use client";

import { useEffect, useMemo, useState } from "react";
import { Search } from "lucide-react";
import { ThemePreview } from "@/components/sermon-builder/theme-preview";
import { Input } from "@/components/ui/input";
import {
  getFeaturedThemes,
  getThemeCategories,
  searchThemes,
  type ThemeCategory,
} from "@/lib/sermon-builder/themes";
import { cn } from "@/lib/utils";

type ThemePickerProps = {
  selectedId: string;
  onSelect: (id: string) => void;
};

export function ThemePicker({ selectedId, onSelect }: ThemePickerProps) {
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [category, setCategory] = useState<ThemeCategory | "all">("all");

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedQuery(query), 200);
    return () => clearTimeout(timer);
  }, [query]);

  const categories = useMemo(() => getThemeCategories(), []);
  const filtered = useMemo(
    () => searchThemes(debouncedQuery, category),
    [debouncedQuery, category],
  );

  const showFeatured =
    !debouncedQuery && category === "all" && filtered.length > 0;
  const featured = useMemo(() => getFeaturedThemes(), []);
  const featuredIds = new Set(featured.map((t) => t.id));
  const nonFeaturedFiltered = showFeatured
    ? filtered.filter((t) => !featuredIds.has(t.id))
    : filtered;

  return (
    <div className="space-y-4">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search themes by name, color, or style…"
          className="pl-9"
        />
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setCategory("all")}
          className={cn(
            "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
            category === "all"
              ? "border-primary bg-primary text-primary-foreground"
              : "border-border hover:border-primary/50",
          )}
        >
          All
        </button>
        {categories.map((cat) => (
          <button
            key={cat.id}
            type="button"
            onClick={() => setCategory(cat.id)}
            className={cn(
              "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
              category === cat.id
                ? "border-primary bg-primary text-primary-foreground"
                : "border-border hover:border-primary/50",
            )}
          >
            {cat.label} ({cat.count})
          </button>
        ))}
      </div>

      <div className="max-h-[400px] space-y-4 overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">
            No themes match your search. Try a different keyword or category.
          </p>
        ) : (
          <>
            {showFeatured && featured.length > 0 && (
              <div className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Featured
                </p>
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {featured.map((theme) => (
                    <ThemePreview
                      key={theme.id}
                      theme={theme}
                      selected={selectedId === theme.id}
                      onSelect={() => onSelect(theme.id)}
                    />
                  ))}
                </div>
              </div>
            )}

            {nonFeaturedFiltered.length > 0 && (
              <div className="space-y-2">
                {showFeatured && (
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    All themes
                  </p>
                )}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                  {nonFeaturedFiltered.map((theme) => (
                    <ThemePreview
                      key={theme.id}
                      theme={theme}
                      selected={selectedId === theme.id}
                      onSelect={() => onSelect(theme.id)}
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
