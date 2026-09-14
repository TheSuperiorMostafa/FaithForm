import { createHash } from "node:crypto";

import { chunkVerses, formatReference } from "@/lib/bible/render";
import type { RenderedVerse } from "@/lib/bible/types";
import type { SlideTheme } from "@/lib/sermon-builder/slide-theme-shared";
import type { Sermon, SermonContent, SermonOutline } from "@/types/sermon";

/**
 * Semantic slide pages for the member-app presentation archive (AD-008).
 *
 * Derives the same page sequence the PPTX exporters use — title, scripture
 * chunks, points, application, closing — as structured text so native apps can
 * render without waiting on image renditions. The manuscript in `content` is
 * never exposed as a free-form blob: only the slide fields below leave the
 * dashboard.
 */

export type PresentationPageKind =
  | "title"
  | "scripture"
  | "point"
  | "application"
  | "closing";

export type PresentationPage = {
  id: string;
  kind: PresentationPageKind;
  title?: string;
  body?: string;
  scripture?: string;
  readingOrder: string[];
};

export type PresentationManifest = {
  pages: PresentationPage[];
};

export type PresentationThemeSnapshot = {
  id: string;
  name: string;
  backgroundType: "solid" | "image";
  bg: string | null;
  bgCss: string;
  text: string;
  accent: string;
  fontHead: string;
  fontBody: string;
  italicRef: boolean;
  textShadow: boolean;
  imageUrl: string | null;
};

export type PresentationScripturePassage = {
  ref: string;
  text: string;
  translation?: string;
};

export type PresentationScriptureSnapshot = {
  translation: string | null;
  passages: PresentationScripturePassage[];
};

export type SimplePassageInput = {
  verses: RenderedVerse[];
  bookName: string;
  chapter: number;
};

const PLACEHOLDER_TITLES = new Set(["", "untitled sermon"]);

function page(
  partial: Omit<PresentationPage, "readingOrder"> & {
    readingOrder?: string[];
  },
): PresentationPage {
  const readingOrder =
    partial.readingOrder ??
    (["title", "scripture", "body"] as const).filter((key) => {
      if (key === "title") return Boolean(partial.title?.trim());
      if (key === "scripture") return Boolean(partial.scripture?.trim());
      return Boolean(partial.body?.trim());
    });
  return { ...partial, readingOrder: [...readingOrder] };
}

function verseChunkToText(verses: RenderedVerse[]): string {
  return verses
    .map((v) => {
      const num = v.number > 1 ? `${v.number} ` : "";
      return `${num}${v.plainText}`;
    })
    .join(" ");
}

/** Same splitting heuristic as `lib/sermon/export-pptx.ts`. */
export function splitScriptureForSlides(
  text: string,
  maxCharsPerSlide = 480,
): string[] {
  const clean = text
    .replace(/\r\n/g, "\n")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
  if (!clean) return [];
  if (clean.length <= maxCharsPerSlide) return [clean];

  const verseChunks = clean.split(/(?=\s*[\[\(]\d+[\]\)])/g).filter(Boolean);
  const useVerses = verseChunks.length > 1;
  const units = useVerses ? verseChunks : clean.split(/(?<=[.!?])\s+/);

  const slides: string[] = [];
  let current = "";
  for (const unit of units) {
    const candidate = current ? `${current} ${unit}`.trim() : unit.trim();
    if (candidate.length > maxCharsPerSlide && current) {
      slides.push(current.trim());
      current = unit.trim();
    } else {
      current = candidate;
    }
  }
  if (current) slides.push(current.trim());
  return slides;
}

function titlePage(sermon: Sermon): PresentationPage {
  const refs = (sermon.scripture_refs ?? []).filter((r) => r.trim()).join("  ·  ");
  const subtitle = refs || sermon.topic?.trim() || undefined;
  return page({
    id: "title",
    kind: "title",
    title: (sermon.title ?? "").trim() || "Sermon",
    body: subtitle,
    readingOrder: subtitle ? ["title", "body"] : ["title"],
  });
}

/**
 * Simple-mode pages: title + scripture chunks (same as `renderSimplePptx`).
 */
export function deriveSimpleManifestPages(
  sermon: Sermon,
  passages: SimplePassageInput[],
  translation: string,
): PresentationPage[] {
  const pages: PresentationPage[] = [titlePage(sermon)];

  if (passages.length === 0) {
    for (const [index, ref] of (sermon.scripture_refs ?? []).entries()) {
      const trimmed = ref.trim();
      if (!trimmed) continue;
      pages.push(
        page({
          id: `scripture-${index}`,
          kind: "scripture",
          scripture: trimmed,
          body: trimmed,
          readingOrder: ["scripture", "body"],
        }),
      );
    }
    return pages;
  }

  passages.forEach((passage, passageIndex) => {
    const chunks = chunkVerses(passage.verses, 64);
    chunks.forEach((chunk, chunkIndex) => {
      const from = chunk[0]?.number ?? 1;
      const to = chunk[chunk.length - 1]?.number ?? from;
      const ref = formatReference(passage.bookName, passage.chapter, from, to);
      const body = verseChunkToText(chunk);
      pages.push(
        page({
          id: `scripture-${passageIndex}-${chunkIndex}`,
          kind: "scripture",
          scripture: ref,
          body,
          title: translation || undefined,
          readingOrder: translation
            ? ["scripture", "body", "title"]
            : ["scripture", "body"],
        }),
      );
    });
  });

  return pages;
}

/**
 * Advanced-mode pages: title, scripture, points, application, closing prayer
 * (same sequence as `renderSermonPptx`).
 */
export function deriveAdvancedManifestPages(
  sermon: Sermon,
  passages: PresentationScripturePassage[] = [],
): PresentationPage[] {
  const pages: PresentationPage[] = [titlePage(sermon)];

  const scripturePassages: PresentationScripturePassage[] =
    passages.length > 0
      ? passages
      : (sermon.scripture_refs ?? [])
          .map((ref) => ref.trim())
          .filter(Boolean)
          .map((ref) => ({ ref, text: "" }));

  scripturePassages.forEach((passage, passageIndex) => {
    const rawText = (passage.text || "").trim();
    const chunks = rawText ? splitScriptureForSlides(rawText) : [passage.ref];
    chunks.forEach((bodyText, chunkIndex) => {
      pages.push(
        page({
          id: `scripture-${passageIndex}-${chunkIndex}`,
          kind: "scripture",
          scripture: passage.ref,
          body: bodyText,
          title: passage.translation || undefined,
          readingOrder: passage.translation
            ? ["scripture", "body", "title"]
            : ["scripture", "body"],
        }),
      );
    });
  });

  const content = sermon.content as SermonContent | null;
  if (content) {
    content.points.forEach((point, i) => {
      pages.push(
        page({
          id: `point-${i}`,
          kind: "point",
          title: `${i + 1}. ${point.title}`,
          body: point.body,
          readingOrder: ["title", "body"],
        }),
      );
    });

    if (content.application?.trim()) {
      pages.push(
        page({
          id: "application",
          kind: "application",
          title: "Application",
          body: content.application.trim(),
          readingOrder: ["title", "body"],
        }),
      );
    }

    if (content.prayer?.trim()) {
      pages.push(
        page({
          id: "closing",
          kind: "closing",
          title: "Closing Prayer",
          body: content.prayer.trim(),
          readingOrder: ["title", "body"],
        }),
      );
    }
  } else {
    // Outline-only advanced sermons still produce a useful deck when content
    // has not been generated yet — never the full manuscript.
    const outline = sermon.outline as SermonOutline | null;
    if (outline?.points?.length) {
      outline.points.forEach((point, i) => {
        pages.push(
          page({
            id: `point-${i}`,
            kind: "point",
            title: `${i + 1}. ${point.title}`,
            body: point.summary,
            scripture: point.scripture,
            readingOrder: point.scripture
              ? ["title", "scripture", "body"]
              : ["title", "body"],
          }),
        );
      });
      if (outline.application?.trim()) {
        pages.push(
          page({
            id: "application",
            kind: "application",
            title: "Application",
            body: outline.application.trim(),
            readingOrder: ["title", "body"],
          }),
        );
      }
      if (outline.closing?.trim()) {
        pages.push(
          page({
            id: "closing",
            kind: "closing",
            title: "Closing",
            body: outline.closing.trim(),
            readingOrder: ["title", "body"],
          }),
        );
      }
    }
  }

  return pages;
}

export function derivePresentationManifest(
  sermon: Sermon,
  options?: {
    simplePassages?: SimplePassageInput[];
    advancedPassages?: PresentationScripturePassage[];
    translation?: string | null;
  },
): PresentationManifest {
  const kind = (sermon.kind ?? "advanced") === "simple" ? "simple" : "advanced";
  const pages =
    kind === "simple"
      ? deriveSimpleManifestPages(
          sermon,
          options?.simplePassages ?? [],
          options?.translation ?? sermon.translation ?? "",
        )
      : deriveAdvancedManifestPages(sermon, options?.advancedPassages ?? []);

  return { pages };
}

export function snapshotTheme(
  theme: SlideTheme | null | undefined,
): PresentationThemeSnapshot | null {
  if (!theme) return null;
  return {
    id: theme.id,
    name: theme.name,
    backgroundType: theme.backgroundType,
    bg: theme.bg,
    bgCss: theme.bgCss,
    text: theme.text,
    accent: theme.accent,
    fontHead: theme.fontHead,
    fontBody: theme.fontBody,
    italicRef: theme.italicRef,
    textShadow: theme.textShadow,
    imageUrl: theme.imageUrl,
  };
}

/** Stable serialization: page order is the content identity. */
export function hashPresentationManifest(manifest: PresentationManifest): string {
  return createHash("sha256")
    .update(JSON.stringify(manifest), "utf8")
    .digest("hex");
}
