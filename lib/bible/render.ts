import type {
  FormattedText,
  InlineHeading,
  InlineLineBreak,
  RenderedVerse,
  TranslationBookChapter,
  VerseFootnoteReference,
  VerseSegment,
} from "./types";

function isFormattedText(v: unknown): v is FormattedText {
  return (
    typeof v === "object" &&
    v !== null &&
    "text" in v &&
    typeof (v as FormattedText).text === "string"
  );
}

function isInlineHeading(v: unknown): v is InlineHeading {
  return typeof v === "object" && v !== null && "heading" in v;
}

function isInlineLineBreak(v: unknown): v is InlineLineBreak {
  return typeof v === "object" && v !== null && "lineBreak" in v;
}

function isFootnoteRef(v: unknown): v is VerseFootnoteReference {
  return typeof v === "object" && v !== null && "noteId" in v;
}

function pushSegment(segments: VerseSegment[], segment: VerseSegment) {
  const last = segments[segments.length - 1];
  if (
    last &&
    !last.lineBreak &&
    !segment.lineBreak &&
    last.wordsOfJesus === segment.wordsOfJesus &&
    last.poem === segment.poem
  ) {
    last.text += segment.text;
    return;
  }
  segments.push(segment);
}

function parseVerseContent(
  content: (
    | string
    | FormattedText
    | InlineHeading
    | InlineLineBreak
    | VerseFootnoteReference
  )[],
): VerseSegment[] {
  const segments: VerseSegment[] = [];

  for (const item of content) {
    if (typeof item === "string") {
      pushSegment(segments, { text: item });
    } else if (isFormattedText(item)) {
      pushSegment(segments, {
        text: item.text,
        wordsOfJesus: item.wordsOfJesus,
        poem: item.poem,
      });
    } else if (isInlineHeading(item)) {
      pushSegment(segments, { text: item.heading });
    } else if (isInlineLineBreak(item)) {
      pushSegment(segments, { text: "", lineBreak: true });
    } else if (isFootnoteRef(item)) {
      // Footnotes omitted from slide body
    }
  }

  return segments;
}

export function extractVersesFromChapter(
  chapter: TranslationBookChapter,
): RenderedVerse[] {
  const verses: RenderedVerse[] = [];

  for (const block of chapter.chapter.content) {
    if (block.type !== "verse") continue;

    const segments = parseVerseContent(block.content);
    const plainText = segments
      .filter((s) => !s.lineBreak)
      .map((s) => s.text)
      .join("")
      .replace(/\s+/g, " ")
      .trim();

    verses.push({
      number: block.number,
      segments,
      plainText,
    });
  }

  return verses;
}

export function sliceVerses(
  verses: RenderedVerse[],
  from: number,
  to: number,
): RenderedVerse[] {
  return verses.filter((v) => v.number >= from && v.number <= to);
}

export function countWords(verses: RenderedVerse[]): number {
  return verses.reduce(
    (sum, v) => sum + v.plainText.split(/\s+/).filter(Boolean).length,
    0,
  );
}

export function chunkVerses(
  verses: RenderedVerse[],
  maxWords = 80,
): RenderedVerse[][] {
  const chunks: RenderedVerse[][] = [];
  let current: RenderedVerse[] = [];
  let wordCount = 0;

  for (const verse of verses) {
    const verseWords = verse.plainText.split(/\s+/).filter(Boolean).length;

    if (current.length > 0 && wordCount + verseWords > maxWords) {
      chunks.push(current);
      current = [];
      wordCount = 0;
    }

    current.push(verse);
    wordCount += verseWords;
  }

  if (current.length > 0) {
    chunks.push(current);
  }

  return chunks.length > 0 ? chunks : [verses];
}

export function formatReference(
  bookName: string,
  chapter: number,
  fromVerse: number,
  toVerse: number,
): string {
  if (fromVerse === toVerse) {
    return `${bookName} ${chapter}:${fromVerse}`;
  }
  return `${bookName} ${chapter}:${fromVerse}–${toVerse}`;
}

export type SlideVerse = {
  n: number;
  text: string;
  wordsOfJesus?: boolean;
  poem?: number;
  segments?: VerseSegment[];
};

export function versesToSlideVerses(verses: RenderedVerse[]): SlideVerse[] {
  return verses.map((v) => ({
    n: v.number,
    text: v.plainText,
    wordsOfJesus: v.segments.some((s) => s.wordsOfJesus),
    poem: v.segments.find((s) => s.poem !== undefined)?.poem,
    segments: v.segments,
  }));
}
