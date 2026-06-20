import { getChapter } from "@/lib/bible/api";
import type { TranslationBookChapter } from "@/lib/bible/types";
import { getEsvChapter } from "@/lib/bible/esv-chapter";
import { getLocalChapter } from "@/lib/bible/local-chapter";
import {
  getTranslationFileCode,
  isEsvTranslation,
  normalizeTranslationId,
  usesLocalTranslationJson,
} from "@/lib/bible/translations";

export async function getChapterForTranslation(
  translation: string,
  bookId: string,
  chapter: number,
): Promise<TranslationBookChapter> {
  const normalized = normalizeTranslationId(translation);

  if (await usesLocalTranslationJson(normalized)) {
    return getLocalChapter(getTranslationFileCode(normalized), bookId, chapter);
  }

  if (isEsvTranslation(normalized)) {
    return getEsvChapter(bookId, chapter);
  }

  if (normalized === "KJV") {
    return getChapter("eng_kjv", bookId, chapter);
  }

  throw new Error(`Translation "${translation}" is not available`);
}
