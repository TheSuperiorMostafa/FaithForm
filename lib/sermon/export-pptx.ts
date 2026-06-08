import PptxGenJS from "pptxgenjs";
import type { Sermon, SermonContent } from "@/types/sermon";

const BRAND_PRIMARY = "0E1428";
const BRAND_PRIMARY_DARK = "0E1428";
const BRAND_MUTED = "94A3B8";

export type ScripturePassage = {
  ref: string;
  text: string;
  translation?: string;
};

/**
 * Normalize raw scripture text:
 *  - collapse whitespace
 *  - join hard-wrapped lines into one paragraph
 *  - trim bracketed verse markers like "[3]" to "³  " style numerals
 */
function normalizeScripture(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Split a long passage on verse boundaries (e.g. " (4) ") if any, else by sentence. */
function splitForSlides(text: string, maxCharsPerSlide = 480): string[] {
  const clean = normalizeScripture(text);
  if (clean.length <= maxCharsPerSlide) return [clean];

  // Try to split on verse markers first: "(N)" or "[N]" pattern.
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

export async function renderSermonPptx(
  sermon: Sermon,
  passages: ScripturePassage[] = [],
): Promise<Buffer> {
  const pptx = new PptxGenJS();
  pptx.author = "FaithForm";
  pptx.title = sermon.title;
  pptx.layout = "LAYOUT_WIDE";

  const SLIDE_W = 13.33;
  const MARGIN_X = 0.6;
  const BODY_W = SLIDE_W - MARGIN_X * 2;

  const content = sermon.content as SermonContent | null;

  const titleSlide = pptx.addSlide();
  titleSlide.background = { color: BRAND_PRIMARY };
  titleSlide.addText(sermon.title, {
    x: MARGIN_X,
    y: 2.4,
    w: BODY_W,
    h: 1.6,
    fontSize: 44,
    bold: true,
    color: "FFFFFF",
    align: "center",
  });
  titleSlide.addText(sermon.scripture_refs.join("  ·  ") || sermon.topic, {
    x: MARGIN_X,
    y: 4.2,
    w: BODY_W,
    h: 0.6,
    fontSize: 20,
    color: "94A3B8",
    align: "center",
  });

  const scripturePassages =
    passages.length > 0
      ? passages
      : sermon.scripture_refs.map((ref) => ({ ref, text: "", translation: "" }));

  for (const passage of scripturePassages) {
    const rawText = (passage.text || "").trim();
    const slides = rawText ? splitForSlides(rawText) : [passage.ref];

    slides.forEach((bodyText) => {
      const slide = pptx.addSlide();

      slide.addText(bodyText, {
        x: MARGIN_X,
        y: 0.5,
        w: BODY_W,
        h: 6.2,
        fontSize: 20,
        valign: "middle",
        paraSpaceAfter: 8,
        fit: "shrink",
      });

      if (passage.translation) {
        slide.addText(passage.translation, {
          x: MARGIN_X,
          y: 6.85,
          w: BODY_W,
          h: 0.35,
          fontSize: 10,
          color: "94A3B8",
          italic: true,
          align: "right",
        });
      }
    });
  }

  if (content) {
    content.points.forEach((point, i) => {
      const slide = pptx.addSlide();
      slide.addText(`${i + 1}. ${point.title}`, {
        x: MARGIN_X,
        y: 0.4,
        w: BODY_W,
        h: 0.8,
        fontSize: 28,
        bold: true,
        color: BRAND_PRIMARY,
      });
      slide.addText(point.body, {
        x: MARGIN_X,
        y: 1.4,
        w: BODY_W,
        h: 5.6,
        fontSize: 16,
        valign: "top",
        paraSpaceAfter: 6,
        fit: "shrink",
      });
    });

    if (content.application?.trim()) {
      const slide = pptx.addSlide();
      slide.addText("Application", {
        x: MARGIN_X,
        y: 0.4,
        w: BODY_W,
        h: 0.8,
        fontSize: 28,
        bold: true,
        color: BRAND_PRIMARY,
      });
      slide.addText(content.application, {
        x: MARGIN_X,
        y: 1.4,
        w: BODY_W,
        h: 5.6,
        fontSize: 18,
        valign: "top",
        paraSpaceAfter: 6,
        fit: "shrink",
      });
    }

    if (content.prayer?.trim()) {
      const slide = pptx.addSlide();
      slide.addText("Closing Prayer", {
        x: MARGIN_X,
        y: 0.4,
        w: BODY_W,
        h: 0.8,
        fontSize: 28,
        bold: true,
        color: BRAND_PRIMARY,
      });
      slide.addText(content.prayer, {
        x: MARGIN_X,
        y: 1.4,
        w: BODY_W,
        h: 5.6,
        fontSize: 18,
        valign: "top",
        paraSpaceAfter: 6,
        italic: true,
        fit: "shrink",
      });
    }
  }

  const output = await pptx.write({ outputType: "nodebuffer" });
  return output as Buffer;
}
