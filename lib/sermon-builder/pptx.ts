import PptxGenJS from "pptxgenjs";
import { chunkVerses, formatReference } from "@/lib/bible/render";
import type { RenderedVerse } from "@/lib/bible/types";
import type { SlideTheme } from "@/lib/queries/slide-themes";
import { getThemeAsync } from "@/lib/sermon-builder/themes";

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
): void {
  if (theme.backgroundType === "image" && theme.imageUrl) {
    slide.background = { path: theme.imageUrl };
    return;
  }
  slide.background = { color: theme.bg ?? "0E1428" };
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
  applySlideBackground(titleSlide, theme);
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
  });

  for (const passage of input.passages) {
    const chunks = chunkVerses(passage.verses, 64);

    for (const chunk of chunks) {
      const bodyText = verseChunkToText(chunk);

      const slide = pptx.addSlide();
      applySlideBackground(slide, theme);

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
      });
    }
  }

  const output = await pptx.write({ outputType: "nodebuffer" });
  return output as Buffer;
}
