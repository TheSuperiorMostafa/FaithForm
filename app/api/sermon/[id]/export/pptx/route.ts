import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity/log";
import { normalizeTranslationId } from "@/lib/bible/translations";
import {
  renderSimplePptx,
  type SimplePassageBlock,
} from "@/lib/sermon-builder/pptx";
import { renderSermonPptx } from "@/lib/sermon/export-pptx";
import { resolveNumberedPassage } from "@/lib/sermon/passages";
import { fetchPassages } from "@/lib/scripture/esv";
import { requireChurchAuth } from "@/lib/auth/church";
import { verifySermonAccess } from "@/lib/queries/sermons";
import { createClient } from "@/lib/supabase/server";
import { featureAccessDenied } from "@/lib/features/guard";
import { SERMON_NOT_FOUND_MESSAGE, sermonRouteError } from "@/lib/sermon-builder/route-error";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const auth = await requireChurchAuth();
    const denied = await featureAccessDenied("sermon_builder");
    if (denied) return denied;
    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, id, auth.churchId);
    if (!sermon) {
      return NextResponse.json({ error: SERMON_NOT_FOUND_MESSAGE }, { status: 404 });
    }

    let buffer: Buffer;

    if ((sermon.kind ?? "advanced") === "simple") {
      const translation = normalizeTranslationId(sermon.translation ?? "KJV");
      const refs = sermon.scripture_refs.filter(Boolean);

      if (refs.length === 0 || !translation) {
        return NextResponse.json(
          { error: "This sermon has no Bible passage yet. Add one in Edit sermon, then download again." },
          { status: 400 },
        );
      }

      const blocks: SimplePassageBlock[] = [];
      let translationLabel = translation;

      for (const ref of refs) {
        // A deck refuses to export a passage it could not resolve — half a
        // reading on the wall is worse than a message saying which one broke.
        const resolved = await resolveNumberedPassage(ref, translation);
        if (!resolved.ok) {
          console.error("[sermon/pptx] passage lookup failed", resolved.ref, resolved.error);
          return NextResponse.json(
            {
              error: `We couldn't look up ${resolved.ref}, so the PowerPoint wasn't made. Check that passage in Edit sermon, then try again.`,
            },
            { status: 400 },
          );
        }

        translationLabel = resolved.passage.translation;
        blocks.push({
          verses: resolved.passage.verses,
          bookName: resolved.passage.bookName,
          chapter: resolved.passage.chapter,
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
      triggerSource: `sermon_module:export:pptx:${id}`,
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    return sermonRouteError(e, "We couldn't make the PowerPoint file.");
  }
}
