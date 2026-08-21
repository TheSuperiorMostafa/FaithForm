import { getChapterForTranslation } from "@/lib/bible/chapter";
import { extractVersesFromChapter, sliceVerses } from "@/lib/bible/render";
import {
  getTranslationShortName,
  normalizeTranslationId,
} from "@/lib/bible/translations";
import type { RenderedVerse } from "@/lib/bible/types";
import { parseScriptureRef } from "@/lib/sermon-builder/parse-ref";
import { resolveBookId } from "@/lib/sermon-builder/resolve-book";
import { fetchPassage } from "@/lib/scripture/esv";

/**
 * A passage resolved for export, verse by verse.
 *
 * Slides have always been built from numbered verses in the translation the
 * church picked. Handouts were not: they went through the free public-domain
 * lookup, so a church teaching from the NIV got a WEB handout with the verse
 * numbers stripped out. This is the shape both exports now share.
 */
export type NumberedPassage = {
  /** Canonical reference as the translation spells it. */
  ref: string;
  bookName: string;
  chapter: number;
  verses: RenderedVerse[];
  /** Short name to print under the passage, e.g. "NIV". */
  translation: string;
};

export type PassageResolution =
  | { ok: true; passage: NumberedPassage }
  | { ok: false; ref: string; error: string };

/**
 * Looks one reference up in `translationId`, keeping verse numbers.
 *
 * Failure is returned rather than thrown so each caller can choose: a slide
 * deck refuses to export half a passage, while a handout would rather fall
 * back than hand back nothing.
 */
export async function resolveNumberedPassage(
  ref: string,
  translationId: string,
): Promise<PassageResolution> {
  const translation = normalizeTranslationId(translationId);
  const parsed = parseScriptureRef(ref);
  if (!parsed) {
    return { ok: false, ref, error: `Could not parse scripture reference: ${ref}` };
  }

  try {
    const book = await resolveBookId(translation, parsed.bookName);
    if (!book) {
      return { ok: false, ref, error: `Book "${parsed.bookName}" not found` };
    }

    const chapterData = await getChapterForTranslation(
      translation,
      book.id,
      parsed.chapter,
    );
    const verses = sliceVerses(
      extractVersesFromChapter(chapterData),
      parsed.verseStart,
      parsed.verseEnd,
    );

    if (verses.length === 0) {
      return { ok: false, ref, error: `No verses found for export: ${ref}` };
    }

    return {
      ok: true,
      passage: {
        ref,
        bookName: book.commonName || book.name,
        chapter: parsed.chapter,
        verses,
        translation:
          chapterData.translation.shortName ??
          getTranslationShortName(translation),
      },
    };
  } catch (e) {
    return {
      ok: false,
      ref,
      error: e instanceof Error ? e.message : `Could not load ${ref}`,
    };
  }
}

export type ExportPassage = NumberedPassage & {
  /**
   * True when the church's translation was unavailable and the passage came
   * from the public-domain fallback instead — the printed credit line has to
   * say so rather than claim a translation we did not actually use.
   */
  fallback: boolean;
};

/**
 * Every reference for an export, in the church's translation where possible.
 *
 * A reference the curated translations cannot serve — an unusual book spelling,
 * a cross-chapter span, a missing local file — falls back to the public-domain
 * lookup and is labelled with whatever that returned, so one awkward reference
 * never costs the whole handout.
 */
export async function resolveExportPassages(
  refs: string[],
  translationId: string,
): Promise<ExportPassage[]> {
  const unique = Array.from(
    new Set(refs.map((ref) => ref.trim()).filter(Boolean)),
  );

  return Promise.all(
    unique.map(async (ref): Promise<ExportPassage> => {
      const resolved = await resolveNumberedPassage(ref, translationId);
      if (resolved.ok) return { ...resolved.passage, fallback: false };

      const parsed = parseScriptureRef(ref);
      const plain = await fetchPassage(ref).catch(() => null);

      return {
        ref: plain?.ref ?? ref,
        bookName: parsed?.bookName ?? ref,
        chapter: parsed?.chapter ?? 0,
        // One unnumbered block: the fallback returns prose, not verse records.
        verses: plain?.text
          ? [{ number: 0, segments: [], plainText: normalizeText(plain.text) }]
          : [],
        translation: plain?.translation ?? "",
        fallback: true,
      };
    }),
  );
}

/** Collapses the hard-wrapped lines the plain-text lookup returns. */
function normalizeText(text: string): string {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}
