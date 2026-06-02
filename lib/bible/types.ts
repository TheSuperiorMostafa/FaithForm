export interface Translation {
  id: string;
  name: string;
  englishName: string;
  website: string;
  licenseUrl: string;
  shortName: string;
  language: string;
  languageName?: string;
  languageEnglishName?: string;
  textDirection: "ltr" | "rtl";
  availableFormats: ("json" | "usfm")[];
  listOfBooksApiLink: string;
  numberOfBooks: number;
  totalNumberOfChapters: number;
  totalNumberOfVerses: number;
  numberOfApocryphalBooks?: number;
  totalNumberOfApocryphalChapters?: number;
  totalNumberOfApocryphalVerses?: number;
}

export interface AvailableTranslations {
  translations: Translation[];
}

export interface TranslationBook {
  id: string;
  translationId?: string;
  name: string;
  commonName: string;
  title: string | null;
  order: number;
  numberOfChapters: number;
  firstChapterNumber: number;
  firstChapterApiLink: string;
  lastChapterNumber: number;
  lastChapterApiLink: string;
  totalNumberOfVerses: number;
  isApocryphal?: boolean;
}

export interface TranslationBooks {
  translation: Translation;
  books: TranslationBook[];
}

export interface ChapterHeading {
  type: "heading";
  content: string[];
}

export interface ChapterLineBreak {
  type: "line_break";
}

export interface ChapterHebrewSubtitle {
  type: "hebrew_subtitle";
  content: (string | FormattedText | VerseFootnoteReference)[];
}

export interface FormattedText {
  text: string;
  poem?: number;
  wordsOfJesus?: boolean;
}

export interface InlineHeading {
  heading: string;
}

export interface InlineLineBreak {
  lineBreak: true;
}

export interface VerseFootnoteReference {
  noteId: number;
}

export interface ChapterVerse {
  type: "verse";
  number: number;
  content: (
    | string
    | FormattedText
    | InlineHeading
    | InlineLineBreak
    | VerseFootnoteReference
  )[];
}

export type ChapterContent =
  | ChapterHeading
  | ChapterLineBreak
  | ChapterHebrewSubtitle
  | ChapterVerse;

export interface ChapterFootnote {
  noteId: number;
  text: string;
  reference?: { chapter: number; verse: number };
  caller: "+" | string | null;
}

export interface ChapterData {
  number: number;
  content: ChapterContent[];
  footnotes: ChapterFootnote[];
}

export interface TranslationBookChapterAudioLinks {
  [reader: string]: string;
}

export interface TranslationBookChapter {
  translation: Translation;
  book: TranslationBook;
  thisChapterLink: string;
  thisChapterAudioLinks: TranslationBookChapterAudioLinks;
  nextChapterApiLink: string | null;
  nextChapterAudioLinks: TranslationBookChapterAudioLinks | null;
  previousChapterApiLink: string | null;
  previousChapterAudioLinks: TranslationBookChapterAudioLinks | null;
  numberOfVerses: number;
  chapter: ChapterData;
}

export type VerseSegment = {
  text: string;
  wordsOfJesus?: boolean;
  poem?: number;
  lineBreak?: boolean;
};

export type RenderedVerse = {
  number: number;
  segments: VerseSegment[];
  plainText: string;
};
