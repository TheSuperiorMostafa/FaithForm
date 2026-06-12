import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import { getChapterForTranslation } from "@/lib/bible/chapter";
import {
  extractVersesFromChapter,
  sliceVerses,
} from "@/lib/bible/render";
import { getCuratedTranslations, isCuratedTranslationId } from "@/lib/bible/translations";
import { buildScriptureRef } from "@/lib/sermon-builder/parse-ref";
import { resolveBookId } from "@/lib/sermon-builder/resolve-book";
import {
  MAX_SIMPLE_PASSAGES,
  type SimplePassageInput,
} from "@/lib/sermon-builder/types";
import { isValidThemeId } from "@/lib/sermon-builder/themes";
import { createSermon } from "@/lib/queries/sermons";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SimpleSermonBody = {
  title: string;
  translation: string;
  theme_id: string;
  passages?: SimplePassageInput[];
  book?: string;
  chapter?: number;
  verseStart?: number;
  verseEnd?: number;
};

function normalizePassages(body: SimpleSermonBody): SimplePassageInput[] {
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

export async function POST(request: Request) {
  try {
    const auth = await requireChurchAuth();
    const body = (await request.json()) as SimpleSermonBody;

    const title = body.title?.trim();
    const translation = body.translation?.trim();
    const theme_id = body.theme_id?.trim();
    const passages = normalizePassages(body);

    if (!title) {
      return NextResponse.json({ error: "Title is required" }, { status: 400 });
    }
    if (!translation || !isCuratedTranslationId(translation)) {
      return NextResponse.json(
        { error: "Invalid translation" },
        { status: 400 },
      );
    }
    const translationOption = getCuratedTranslations().find(
      (t) => t.id === translation,
    );
    if (!translationOption?.enabled) {
      return NextResponse.json(
        { error: "This translation is not available yet" },
        { status: 400 },
      );
    }
    if (!theme_id || !(await isValidThemeId(theme_id))) {
      return NextResponse.json({ error: "Invalid theme" }, { status: 400 });
    }
    if (passages.length === 0) {
      return NextResponse.json(
        { error: "At least one passage is required" },
        { status: 400 },
      );
    }
    if (passages.length > MAX_SIMPLE_PASSAGES) {
      return NextResponse.json(
        { error: `Maximum ${MAX_SIMPLE_PASSAGES} passages per deck` },
        { status: 400 },
      );
    }

    for (const passage of passages) {
      const bookName = passage.book?.trim();
      const chapter = Number(passage.chapter);
      const verseStart = Number(passage.verseStart) || 1;
      const verseEnd = Number(passage.verseEnd) || verseStart;

      if (!bookName || !chapter) {
        return NextResponse.json(
          { error: "Each passage needs a book and chapter" },
          { status: 400 },
        );
      }
      if (verseEnd < verseStart) {
        return NextResponse.json(
          { error: "Invalid verse range in one or more passages" },
          { status: 400 },
        );
      }
    }

    const scripture_refs: string[] = [];
    for (const passage of passages) {
      const ref = await resolvePassageRef(translation, passage);
      scripture_refs.push(ref);
    }

    const sermon = await createSermon({
      churchId: auth.churchId,
      userId: auth.userId,
      title,
      topic: "",
      scripture_refs,
      audience: "General congregation",
      duration_min: 0,
      kind: "simple",
      theme_id,
      translation,
    });

    return NextResponse.json({ sermon: { id: sermon.id } });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not create sermon";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
