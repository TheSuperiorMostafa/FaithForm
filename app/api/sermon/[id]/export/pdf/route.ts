import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity/log";
import { requireChurchAuth } from "@/lib/auth/church";
import { getLatestAsset, verifySermonAccess } from "@/lib/queries/sermons";
import { renderSermonPdf } from "@/lib/sermon/export-pdf";
import { fetchPassages } from "@/lib/scripture/esv";
import { createClient } from "@/lib/supabase/server";
import { featureAccessDenied } from "@/lib/features/guard";
import type { DiscussionQuestion } from "@/types/sermon";

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

    const passages =
      sermon.scripture_refs.length > 0
        ? await fetchPassages(sermon.scripture_refs).catch(() => [])
        : [];

    // Discussion questions ship in the same PDF so a lesson is one download.
    const questionsAsset = await getLatestAsset(
      params.id,
      "discussion_questions",
    );
    const questions =
      (questionsAsset?.payload as { questions?: DiscussionQuestion[] } | null)
        ?.questions ?? [];

    const buffer = await renderSermonPdf(sermon, passages, questions);
    const filename = `${sermon.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "sermon"}.pdf`;

    await logActivity({
      churchId: auth.churchId,
      automationType: "Sermon PDF Exported",
      taskName: sermon.title,
      triggerSource: `sermon_module:export:pdf:${params.id}`,
    });

    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : "PDF export failed";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
