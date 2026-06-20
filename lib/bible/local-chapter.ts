import { getBooks } from "@/lib/bible/api";
import { resolveLocalBookKey } from "@/lib/bible/book-names";
import { loadLocalTranslationJson } from "@/lib/bible/local-data";
import type {
  RenderedVerse,
  TranslationBook,
  TranslationBookChapter,
} from "@/lib/bible/types";
import { getTranslationShortName } from "@/lib/bible/translations";

async function resolveBook(bookId: string): Promise<TranslationBook> {
  const { books } = await getBooks("eng_kjv");
  const book = books.find((b) => b.id === bookId);
  if (!book) {
    throw new Error(`Book not found: ${bookId}`);
  }
  return book;
}

function versesFromChapterData(
  chapterData: Record<string, string>,
): RenderedVerse[] {
  return Object.entries(chapterData)
    .map(([verseNum, text]) => ({
      number: Number.parseInt(verseNum, 10),
      segments: [{ text: text.trim() }],
      plainText: text.replace(/\s+/g, " ").trim(),
    }))
    .filter((v) => v.plainText.length > 0 && !Number.isNaN(v.number))
    .sort((a, b) => a.number - b.number);
}

export async function getLocalChapter(
  translationCode: string,
  bookId: string,
  chapter: number,
): Promise<TranslationBookChapter> {
  const bible = await loadLocalTranslationJson(translationCode);
  if (!bible) {
    throw new Error(`Local Bible file not found for ${translationCode}`);
  }

  const book = await resolveBook(bookId);
  const bookKey = resolveLocalBookKey(
    bookId,
    book.commonName || book.name,
    Object.keys(bible),
  );

  if (!bookKey) {
    throw new Error(
      `Book "${book.commonName || book.name}" not found in ${translationCode} JSON`,
    );
  }

  const chapterKey = String(chapter);
  const chapterData = bible[bookKey]?.[chapterKey];
  if (!chapterData) {
    throw new Error(
      `${bookKey} ${chapter} not found in ${translationCode} JSON`,
    );
  }

  const parsedVerses = versesFromChapterData(chapterData);
  if (parsedVerses.length === 0) {
    throw new Error(`No verses found for ${bookKey} ${chapter}`);
  }

  const shortName = getTranslationShortName(translationCode);
  const verses = parsedVerses.map((v) => ({
    type: "verse" as const,
    number: v.number,
    content: [v.plainText] as string[],
  }));

  return {
    translation: {
      id: translationCode,
      name: shortName,
      englishName: shortName,
      website: "",
      licenseUrl: "",
      shortName,
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
