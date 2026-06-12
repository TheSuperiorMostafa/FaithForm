"use client";

import { getCategoryLabel } from "@/lib/sermon-builder/themes";
import type { SlideTheme } from "@/lib/sermon-builder/slide-theme-shared";
import { cn } from "@/lib/utils";

const SAMPLE_VERSE =
  "For God so loved the world, that he gave his only Son";

type ThemePreviewProps = {
  theme: SlideTheme;
  selected: boolean;
  onSelect: () => void;
  compact?: boolean;
};

export function ThemePreview({
  theme,
  selected,
  onSelect,
  compact = false,
}: ThemePreviewProps) {
  const backgroundStyle =
    theme.backgroundType === "image" && theme.imageUrl
      ? {
          backgroundImage: `url(${theme.imageUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }
      : { background: theme.bgCss };

  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "group flex flex-col overflow-hidden rounded-xl border-2 text-left transition-all",
        selected
          ? "border-primary ring-2 ring-primary/30"
          : "border-border hover:border-primary/50",
      )}
    >
      <div
        className={cn(
          "relative flex aspect-video w-full items-center justify-center p-3",
          theme.backgroundType === "image" && "bg-muted",
        )}
        style={backgroundStyle}
      >
        {theme.backgroundType === "image" && theme.textShadow && (
          <div className="absolute inset-0 bg-black/25" aria-hidden />
        )}
        <p
          className={cn(
            "relative line-clamp-3 text-center leading-tight",
            compact ? "text-[8px]" : "text-[9px]",
            theme.textShadow && "drop-shadow-md",
          )}
          style={{
            color: `#${theme.text}`,
            fontFamily: theme.fontBody,
          }}
        >
          {SAMPLE_VERSE}
        </p>
      </div>
      {!compact && (
        <div className="border-t border-border bg-card px-2.5 py-2">
          <div className="flex items-start justify-between gap-1">
            <p className="text-xs font-medium">{theme.name}</p>
            <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] capitalize text-muted-foreground">
              {getCategoryLabel(theme.category)}
            </span>
          </div>
          <p className="line-clamp-1 text-[10px] text-muted-foreground">
            {theme.description}
          </p>
        </div>
      )}
    </button>
  );
}
