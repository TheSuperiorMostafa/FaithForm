import { getBooks } from "@/lib/bible/api";
import { getBooksTranslationId } from "@/lib/bible/translations";
import type { TranslationBook } from "@/lib/bible/types";

/** Match a human book name to a translation book id (e.g. "John" -> "JHN"). */
export async function resolveBookId(
  translation: string,
  bookName: string,
): Promise<TranslationBook | null> {
  const { books } = await getBooks(getBooksTranslationId(translation));
  const lc = bookName.trim().toLowerCase();

  const exact = books.find(
    (b) =>
      b.name.toLowerCase() === lc ||
      b.commonName.toLowerCase() === lc ||
      (b.title?.toLowerCase() ?? "") === lc,
  );
  if (exact) return exact;

  const partial = books.find(
    (b) =>
      b.name.toLowerCase().includes(lc) ||
      b.commonName.toLowerCase().includes(lc),
  );
  return partial ?? null;
}
