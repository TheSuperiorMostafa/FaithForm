import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity/log";
import { getChapterForTranslation } from "@/lib/bible/chapter";
import {
  extractVersesFromChapter,
  sliceVerses,
} from "@/lib/bible/render";
import { getTranslationShortName, isCuratedTranslationId, normalizeTranslationId } from "@/lib/bible/translations";
import { parseScriptureRef } from "@/lib/sermon-builder/parse-ref";
import {
  renderSimplePptx,
  type SimplePassageBlock,
} from "@/lib/sermon-builder/pptx";
import { resolveBookId } from "@/lib/sermon-builder/resolve-book";
import { renderSermonPptx } from "@/lib/sermon/export-pptx";
import { fetchPassages } from "@/lib/scripture/esv";
import { requireChurchAuth } from "@/lib/auth/church";
import { verifySermonAccess } from "@/lib/queries/sermons";
import { createClient } from "@/lib/supabase/server";
import { featureAccessDenied } from "@/lib/features/guard";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("sermon_builder");
    if (denied) return denied;
    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, params.id, auth.churchId);
    if (!sermon) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    let buffer: Buffer;

    if ((sermon.kind ?? "advanced") === "simple") {
      const translation = normalizeTranslationId(sermon.translation ?? "KJV");
      const refs = sermon.scripture_refs.filter(Boolean);

      if (refs.length === 0 || !translation) {
        return NextResponse.json(
          { error: "Simple sermon is missing scripture or translation" },
          { status: 400 },
        );
      }

      const blocks: SimplePassageBlock[] = [];
      let translationLabel = translation;

      for (const ref of refs) {
        const parsed = parseScriptureRef(ref);
        if (!parsed) {
          return NextResponse.json(
            { error: `Could not parse scripture reference: ${ref}` },
            { status: 400 },
          );
        }

        const book = await resolveBookId(translation, parsed.bookName);
        if (!book) {
          return NextResponse.json(
            { error: `Book "${parsed.bookName}" not found` },
            { status: 400 },
          );
        }

        const chapterData = await getChapterForTranslation(
          translation,
          book.id,
          parsed.chapter,
        );
        const allVerses = extractVersesFromChapter(chapterData);
        const verses = sliceVerses(
          allVerses,
          parsed.verseStart,
          parsed.verseEnd,
        );

        if (verses.length === 0) {
          return NextResponse.json(
            { error: `No verses found for export: ${ref}` },
            { status: 400 },
          );
        }

        translationLabel =
          chapterData.translation.shortName ??
          getTranslationShortName(translation);

        blocks.push({
          verses,
          bookName: book.commonName || book.name,
          chapter: parsed.chapter,
        });
      }

      buffer = await renderSimplePptx({
        title: sermon.title,
        themeId: sermon.theme_id ?? "midnight",
        translation: translationLabel,
        passages: blocks,
        scriptureRefsSummary: refs.join(" · "),
      });
    } else {
      const passages =
        sermon.scripture_refs.length > 0
          ? await fetchPassages(sermon.scripture_refs).catch(() => [])
          : [];

      buffer = await renderSermonPptx(sermon, passages);
    }

    const filename = `${sermon.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "sermon"}.pptx`;

    await logActivity({
      churchId: auth.churchId,
      automationType: "Sermon PPTX Exported",
      taskName: sermon.title,
      triggerSource: `sermon_module:export:pptx:${params.id}`,
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "PPTX export failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
