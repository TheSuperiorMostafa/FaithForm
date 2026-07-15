import { getChapterForTranslation } from "@/lib/bible/chapter";
import {
  extractVersesFromChapter,
  sliceVerses,
} from "@/lib/bible/render";
import {
  getCuratedTranslations,
  isCuratedTranslationId,
  normalizeTranslationId,
} from "@/lib/bible/translations";
import { buildScriptureRef } from "@/lib/sermon-builder/parse-ref";
import { resolveBookId } from "@/lib/sermon-builder/resolve-book";
import {
  MAX_SIMPLE_PASSAGES,
  type SimplePassageInput,
} from "@/lib/sermon-builder/types";
import { isValidSlideThemeId, listSlideThemes } from "@/lib/queries/slide-themes";

export type SimpleSermonSaveBody = {
  title: string;
  translation: string;
  theme_id: string;
  sermon_date?: string | null;
  passages?: SimplePassageInput[];
  book?: string;
  chapter?: number;
  verseStart?: number;
  verseEnd?: number;
};

export function normalizePassages(body: SimpleSermonSaveBody): SimplePassageInput[] {
  if (body.passages && body.passages.length > 0) {
    return body.passages;
  }
  const book = body.book?.trim();
  const chapter = Number(body.chapter);
  if (!book || !chapter) return [];
  const verseStart = Number(body.verseStart) || 1;
  const verseEnd = Number(body.verseEnd) || verseStart;
  return [{ book, chapter, verseStart, verseEnd }];
}

function isValidSermonDate(value: string | null | undefined): boolean {
  if (value == null || value === "") return true;
  return /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(value));
}

async function resolvePassageRef(
  translation: string,
  passage: SimplePassageInput,
): Promise<string> {
  const bookName = passage.book.trim();
  const chapter = Number(passage.chapter);
  const verseStart = Number(passage.verseStart) || 1;
  const verseEnd = Number(passage.verseEnd) || verseStart;

  let resolvedBookName = bookName;
  try {
    const book = await resolveBookId(translation, bookName);
    if (book) {
      resolvedBookName = book.commonName || book.name;
      const chapterData = await getChapterForTranslation(translation, book.id, chapter);
      const allVerses = extractVersesFromChapter(chapterData);
      const verses = sliceVerses(allVerses, verseStart, verseEnd);

      if (verses.length === 0) {
        throw new Error(
          `No verses found for ${buildScriptureRef(resolvedBookName, chapter, verseStart, verseEnd)}`,
        );
      }
    }
  } catch (e) {
    if (e instanceof Error && e.message.startsWith("No verses found")) {
      throw e;
    }
    // helloao API hiccup — accept the request, export route will retry.
  }

  return buildScriptureRef(resolvedBookName, chapter, verseStart, verseEnd);
}

export type ValidatedSimpleSermon = {
  title: string;
  translation: string;
  theme_id: string;
  sermon_date: string | null;
  scripture_refs: string[];
};

export async function validateSimpleSermonBody(
  body: SimpleSermonSaveBody,
): Promise<{ error: string; status: number } | ValidatedSimpleSermon> {
  const title = body.title?.trim();
  const translation = body.translation?.trim();
  let theme_id = body.theme_id?.trim() ?? "";
  const sermon_date = body.sermon_date?.trim() || null;
  const passages = normalizePassages(body);

  if (!title) {
    return { error: "Title is required", status: 400 };
  }
  const normalizedTranslation = normalizeTranslationId(translation);
  if (!translation || !isCuratedTranslationId(normalizedTranslation)) {
    return { error: "Invalid translation", status: 400 };
  }
  const translationOption = (await getCuratedTranslations()).find(
    (t) => t.id === normalizedTranslation,
  );
  if (!translationOption?.enabled) {
    return { error: "This translation is not available yet", status: 400 };
  }
  if (!theme_id || !(await isValidSlideThemeId(theme_id))) {
    const themes = await listSlideThemes();
    const fallback =
      themes.find((t) => t.id === "midnight") ??
      themes.find((t) => t.featured) ??
      themes[0];
    if (!fallback) {
      return { error: "Invalid theme", status: 400 };
    }
    theme_id = fallback.id;
  }
  if (!isValidSermonDate(sermon_date)) {
    return { error: "Invalid sermon date", status: 400 };
  }
  if (passages.length === 0) {
    return { error: "At least one passage is required", status: 400 };
  }
  if (passages.length > MAX_SIMPLE_PASSAGES) {
    return {
      error: `Maximum ${MAX_SIMPLE_PASSAGES} passages per deck`,
      status: 400,
    };
  }

  for (const passage of passages) {
    const bookName = passage.book?.trim();
    const chapter = Number(passage.chapter);
    const verseStart = Number(passage.verseStart) || 1;
    const verseEnd = Number(passage.verseEnd) || verseStart;

    if (!bookName || !chapter) {
      return { error: "Each passage needs a book and chapter", status: 400 };
    }
    if (verseEnd < verseStart) {
      return { error: "Invalid verse range in one or more passages", status: 400 };
    }
  }

  const scripture_refs: string[] = [];
  for (const passage of passages) {
    const ref = await resolvePassageRef(normalizedTranslation, passage);
    scripture_refs.push(ref);
  }

  return {
    title,
    translation: normalizedTranslation,
    theme_id,
    sermon_date,
    scripture_refs,
  };
}
