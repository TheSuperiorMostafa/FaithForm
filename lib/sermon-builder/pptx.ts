import PptxGenJS from "pptxgenjs";
import { chunkVerses, formatReference } from "@/lib/bible/render";
import type { RenderedVerse } from "@/lib/bible/types";
import type { SlideTheme } from "@/lib/sermon-builder/slide-theme-shared";
import {
  imageTextShadow,
  toThemeBackgroundImage,
  type ThemeBackgroundImage,
} from "@/lib/sermon-builder/pptx-media";
import { getThemeAsync } from "@/lib/queries/slide-themes";

const SLIDE_W = 13.33;
const SLIDE_H = 7.5;
const MARGIN_X = 0.5;
const BODY_W = SLIDE_W - MARGIN_X * 2;

function verseChunkToText(verses: RenderedVerse[]): string {
  return verses
    .map((v) => {
      const num = v.number > 1 ? `${v.number} ` : "";
      return `${num}${v.plainText}`;
    })
    .join(" ");
}

function countWords(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** Calibrated for 12.33" × 5.7" body box; prefers larger text, then shrink-to-fit. */
export function pickBodyFontSize(text: string): number {
  const words = countWords(text);
  if (words <= 8) return 92;
  if (words <= 16) return 74;
  if (words <= 28) return 60;
  if (words <= 45) return 50;
  if (words <= 65) return 42;
  if (words <= 90) return 36;
  if (words <= 120) return 30;
  return 26;
}

function applySlideBackground(
  slide: { background: PptxGenJS.BackgroundProps },
  theme: SlideTheme,
  image?: ThemeBackgroundImage | null,
): void {
  if (theme.backgroundType === "image" && image) {
    // `path` is never read from disk — pptxgenjs only takes the media part's
    // extension from it, which must match the bytes or PowerPoint flags the
    // deck as damaged.
    slide.background = { data: image.data, path: image.path };
    return;
  }
  // Fall back to solid color if remote image fetch failed.
  slide.background = { color: theme.bg ?? "0E1428" };
}

async function resolveThemeImage(
  theme: SlideTheme,
): Promise<ThemeBackgroundImage | null> {
  if (theme.backgroundType !== "image" || !theme.imageUrl) return null;
  try {
    const res = await fetch(theme.imageUrl);
    if (!res.ok) return null;
    return await toThemeBackgroundImage(Buffer.from(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

export type SimplePassageBlock = {
  verses: RenderedVerse[];
  bookName: string;
  chapter: number;
};

export type SimplePptxInput = {
  title: string;
  themeId: string;
  translation: string;
  passages: SimplePassageBlock[];
  scriptureRefsSummary?: string;
};

export async function renderSimplePptx(input: SimplePptxInput): Promise<Buffer> {
  const theme = await getThemeAsync(input.themeId);
  const image = await resolveThemeImage(theme);
  const pptx = new PptxGenJS();
  pptx.author = "FaithForm";
  pptx.title = input.title;
  pptx.layout = "LAYOUT_WIDE";

  const refsSummary =
    input.scriptureRefsSummary ??
    input.passages
      .map((p) => {
        const from = p.verses[0]?.number ?? 1;
        const to = p.verses[p.verses.length - 1]?.number ?? from;
        return formatReference(p.bookName, p.chapter, from, to);
      })
      .join(" · ");

  const titleSlide = pptx.addSlide();
  applySlideBackground(titleSlide, theme, image);
  titleSlide.addText(input.title, {
    x: MARGIN_X,
    y: 2.2,
    w: BODY_W,
    h: 1.8,
    fontSize: 44,
    bold: true,
    color: theme.text,
    fontFace: theme.fontHead,
    align: "center",
    valign: "middle",
    shadow: imageTextShadow(theme),
  });
  titleSlide.addText(refsSummary, {
    x: MARGIN_X,
    y: 4.2,
    w: BODY_W,
    h: 0.6,
    fontSize: refsSummary.length > 60 ? 16 : 22,
    color: theme.accent,
    fontFace: theme.fontHead,
    align: "center",
    italic: theme.italicRef ?? false,
    shadow: imageTextShadow(theme),
  });

  for (const passage of input.passages) {
    const chunks = chunkVerses(passage.verses, 64);

    for (const chunk of chunks) {
      const bodyText = verseChunkToText(chunk);

      const slide = pptx.addSlide();
      applySlideBackground(slide, theme, image);

      slide.addText(bodyText, {
        x: MARGIN_X,
        y: 0.5,
        w: BODY_W,
        h: 6.2,
        fontSize: pickBodyFontSize(bodyText),
        color: theme.text,
        fontFace: theme.fontBody,
        align: "center",
        valign: "middle",
        fit: "shrink",
        paraSpaceAfter: 6,
        lineSpacingMultiple: 1.15,
        shadow: imageTextShadow(theme),
      });

      slide.addText(input.translation, {
        x: MARGIN_X,
        y: 6.85,
        w: BODY_W,
        h: 0.35,
        fontSize: 9,
        color: theme.accent,
        fontFace: theme.fontHead,
        align: "right",
        italic: true,
        shadow: imageTextShadow(theme),
      });
    }
  }

  const output = await pptx.write({ outputType: "nodebuffer" });
  return output as Buffer;
}
