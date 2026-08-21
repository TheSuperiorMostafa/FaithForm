import { NextResponse } from "next/server";
import { logActivity } from "@/lib/activity/log";
import { requireChurchAuth } from "@/lib/auth/church";
import { getDefaultTranslationId } from "@/lib/bible/translations";
import { getChurchAISettings, verifySermonAccess } from "@/lib/queries/sermons";
import { renderSermonPdf } from "@/lib/sermon/export-pdf";
import { resolveExportPassages } from "@/lib/sermon/passages";
import { createClient } from "@/lib/supabase/server";
import { featureAccessDenied } from "@/lib/features/guard";

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
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    // The deck's own translation wins; otherwise the church default, the same
    // one the slides use. Neither set is what put every handout in WEB.
    const settings = await getChurchAISettings(auth.churchId);
    const translation =
      sermon.translation ??
      (await getDefaultTranslationId(settings?.default_translation));

    const passages =
      sermon.scripture_refs.length > 0
        ? await resolveExportPassages(sermon.scripture_refs, translation).catch(
            () => [],
          )
        : [];

    const buffer = await renderSermonPdf(sermon, passages);
    const filename = `${sermon.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "sermon"}.pdf`;

    await logActivity({
      churchId: auth.churchId,
      automationType: "Sermon PDF Exported",
      taskName: sermon.title,
      triggerSource: `sermon_module:export:pdf:${id}`,
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
