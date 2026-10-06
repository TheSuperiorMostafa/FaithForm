"use client";

import { chunkVerses } from "@/lib/bible/render";
import type { RenderedVerse } from "@/lib/bible/types";
import type { SlideTheme } from "@/lib/sermon-builder/slide-theme-shared";
import { getTheme } from "@/lib/sermon-builder/themes";
import { SlideView } from "@/components/sermon-builder/slide-view";
import { cn } from "@/lib/utils";

type SlidePreviewProps = {
  themeId: string;
  theme?: SlideTheme | null;
  verses: RenderedVerse[];
  reference: string;
  translation?: string;
  className?: string;
};

export function SlidePreview({ themeId, theme: themeProp, verses, reference, translation, className }: SlidePreviewProps) {
  const theme = themeProp ?? getTheme(themeId);
  // Match the exported deck's chunking, sizing, theme and overflow fitting.
  const firstChunk = chunkVerses(verses, 64)[0] ?? verses;
  const body = firstChunk.map((verse) => `${verse.number > 1 ? `${verse.number} ` : ""}${verse.plainText}`).join(" ");
  return (
    <SlideView
      className={cn("rounded-xl border border-border shadow-card", className)}
      theme={theme}
      page={{
        id: `preview-${reference}-${body}`,
        kind: "scripture",
        body: body || "Select verses to preview",
        scripture: reference,
        title: translation,
        readingOrder: ["scripture", "body", "title"],
      }}
    />
  );
}
