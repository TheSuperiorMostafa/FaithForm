import { getBooks } from "@/lib/bible/api";
import type {
  RenderedVerse,
  TranslationBook,
  TranslationBookChapter,
} from "@/lib/bible/types";

function parseEsvChapterText(text: string): RenderedVerse[] {
  const verses: RenderedVerse[] = [];
  const regex = /\[(\d+)\]\s*([\s\S]*?)(?=\[\d+\]|$)/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(text)) !== null) {
    const number = Number.parseInt(match[1]!, 10);
    const plainText = match[2]!.replace(/\s+/g, " ").trim();
    if (!plainText) continue;
    verses.push({
      number,
      segments: [{ text: plainText }],
      plainText,
    });
  }

  return verses;
}

async function fetchEsvChapterText(
  ref: string,
  apiKey: string,
): Promise<string> {
  const params = new URLSearchParams({
    q: ref,
    "include-passage-references": "false",
    "include-headings": "false",
    "include-footnotes": "false",
    "include-verse-numbers": "true",
    "include-short-copyright": "false",
    "include-passage-horizontal-lines": "false",
    "horizontal-line-length": "0",
    "include-heading-horizontal-lines": "false",
    "heading-horizontal-line-length": "0",
  });

  const res = await fetch(
    `https://api.esv.org/v3/passage/text/?${params.toString()}`,
    {
      headers: { Authorization: `Token ${apiKey}` },
      next: { revalidate: 86400 },
    },
  );

  if (!res.ok) {
    throw new Error(`ESV API error: ${res.status} ${res.statusText}`);
  }

  const data = (await res.json()) as { passages: string[] };
  return (data.passages?.[0] ?? "").trim();
}

async function resolveBook(bookId: string): Promise<TranslationBook> {
  const { books } = await getBooks("eng_kjv");
  const book = books.find((b) => b.id === bookId);
  if (!book) {
    throw new Error(`Book not found: ${bookId}`);
  }
  return book;
}

export async function getEsvChapter(
  bookId: string,
  chapter: number,
): Promise<TranslationBookChapter> {
  const apiKey = process.env.ESV_API_KEY;
  if (!apiKey) {
    throw new Error("ESV translation requires ESV_API_KEY");
  }

  const book = await resolveBook(bookId);
  const bookName = book.commonName || book.name;
  const text = await fetchEsvChapterText(`${bookName} ${chapter}`, apiKey);
  const parsedVerses = parseEsvChapterText(text);

  if (parsedVerses.length === 0) {
    throw new Error(`No verses found for ${bookName} ${chapter}`);
  }

  const verses = parsedVerses.map((v) => ({
    type: "verse" as const,
    number: v.number,
    content: [v.plainText] as string[],
  }));

  return {
    translation: {
      id: "ESV",
      name: "English Standard Version",
      englishName: "English Standard Version",
      website: "https://www.esv.org",
      licenseUrl: "https://www.esv.org",
      shortName: "ESV",
      language: "eng",
      textDirection: "ltr",
      availableFormats: ["json"],
      listOfBooksApiLink: "",
      numberOfBooks: 66,
      totalNumberOfChapters: 1189,
      totalNumberOfVerses: 31086,
    },
    book,
    thisChapterLink: "",
    thisChapterAudioLinks: {},
    nextChapterApiLink: null,
    nextChapterAudioLinks: null,
    previousChapterApiLink: null,
    previousChapterAudioLinks: null,
    numberOfVerses: parsedVerses[parsedVerses.length - 1]!.number,
    chapter: {
      number: chapter,
      content: verses,
      footnotes: [],
    },
  };
}
