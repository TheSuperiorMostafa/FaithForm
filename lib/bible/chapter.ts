import { getChapter } from "@/lib/bible/api";
import type { TranslationBookChapter } from "@/lib/bible/types";
import { getEsvChapter } from "@/lib/bible/esv-chapter";
import {
  getBooksTranslationId,
  isEsvTranslation,
} from "@/lib/bible/translations";

export async function getChapterForTranslation(
  translation: string,
  bookId: string,
  chapter: number,
): Promise<TranslationBookChapter> {
  if (isEsvTranslation(translation)) {
    return getEsvChapter(bookId, chapter);
  }
  return getChapter(getBooksTranslationId(translation), bookId, chapter);
}
