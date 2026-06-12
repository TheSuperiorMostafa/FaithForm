"use client";

import { chunkVerses } from "@/lib/bible/render";
import type { RenderedVerse } from "@/lib/bible/types";
import type { SlideTheme } from "@/lib/queries/slide-themes";
import { getTheme } from "@/lib/sermon-builder/themes";
import { cn } from "@/lib/utils";

type SlidePreviewProps = {
  themeId: string;
  theme?: SlideTheme | null;
  verses: RenderedVerse[];
  reference: string;
  translation?: string;
  className?: string;
};

function verseChunkToText(verses: RenderedVerse[]): string {
  return verses
    .map((v) => {
      const num = v.number > 1 ? `${v.number} ` : "";
      return `${num}${v.plainText}`;
    })
    .join(" ");
}

function previewSizeClass(text: string): string {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (words <= 8) return "text-3xl sm:text-4xl md:text-5xl";
  if (words <= 16) return "text-2xl sm:text-3xl md:text-4xl";
  if (words <= 28) return "text-xl sm:text-2xl md:text-3xl";
  if (words <= 45) return "text-lg sm:text-xl md:text-2xl";
  if (words <= 70) return "text-base sm:text-lg md:text-xl";
  if (words <= 110) return "text-sm sm:text-base md:text-lg";
  return "text-xs sm:text-sm md:text-base";
}

export function SlidePreview({
  themeId,
  theme: themeProp,
  verses,
  translation,
  className,
}: SlidePreviewProps) {
  const theme = themeProp ?? getTheme(themeId);
  const chunks = chunkVerses(verses, 80);
  const firstChunk = chunks[0] ?? verses;
  const bodyText = verseChunkToText(firstChunk);

  const backgroundStyle =
    theme.backgroundType === "image" && theme.imageUrl
      ? {
          backgroundImage: `url(${theme.imageUrl})`,
          backgroundSize: "cover",
          backgroundPosition: "center",
        }
      : { background: theme.bgCss };

  return (
    <div
      className={cn(
        "relative aspect-video w-full overflow-hidden rounded-xl border border-border shadow-card",
        theme.backgroundType === "image" && "bg-muted",
        className,
      )}
      style={backgroundStyle}
    >
      {theme.backgroundType === "image" && theme.textShadow && (
        <div className="absolute inset-0 bg-black/25" aria-hidden />
      )}
      <p
        className={cn(
          "absolute inset-x-4 top-1/2 max-h-[70%] -translate-y-1/2 overflow-hidden text-center font-medium leading-snug",
          previewSizeClass(bodyText),
          theme.textShadow && "drop-shadow-md",
        )}
        style={{
          color: `#${theme.text}`,
          fontFamily: theme.fontBody,
        }}
      >
        {bodyText || "Select verses to preview"}
      </p>
      {translation && (
        <p
          className="absolute bottom-3 right-4 text-[10px] italic opacity-70"
          style={{ color: `#${theme.accent}` }}
        >
          {translation}
        </p>
      )}
    </div>
  );
}
