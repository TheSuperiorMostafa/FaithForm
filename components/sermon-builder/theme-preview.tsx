"use client";

import type { SlideTheme } from "@/lib/sermon-builder/themes";
import { cn } from "@/lib/utils";

const SAMPLE_VERSE =
  "For God so loved the world, that he gave his only Son";

type ThemePreviewProps = {
  theme: SlideTheme;
  selected: boolean;
  onSelect: () => void;
};

export function ThemePreview({ theme, selected, onSelect }: ThemePreviewProps) {
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
        className="relative aspect-video w-full p-3"
        style={{ background: theme.bgCss }}
      >
        <p
          className="text-[8px] font-medium opacity-80"
          style={{ color: `#${theme.accent}` }}
        >
          John 3:16
        </p>
        <p
          className="mt-1 line-clamp-3 text-[9px] leading-tight"
          style={{
            color: `#${theme.text}`,
            fontFamily: theme.fontBody,
          }}
        >
          {SAMPLE_VERSE}
        </p>
      </div>
      <div className="border-t border-border bg-card px-2.5 py-2">
        <p className="text-xs font-medium">{theme.name}</p>
        <p className="line-clamp-1 text-[10px] text-muted-foreground">
          {theme.description}
        </p>
      </div>
    </button>
  );
}
