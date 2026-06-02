import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import { verifySermonAccess } from "@/lib/queries/sermons";
import { renderSermonPdf } from "@/lib/sermon/export-pdf";
import { fetchPassages } from "@/lib/scripture/esv";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  try {
    const auth = await requireChurchAuth();
    const supabase = createClient();
    const sermon = await verifySermonAccess(supabase, params.id, auth.churchId);
    if (!sermon) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    const passages =
      sermon.scripture_refs.length > 0
        ? await fetchPassages(sermon.scripture_refs).catch(() => [])
        : [];

    const buffer = await renderSermonPdf(sermon, passages);
    const filename = `${sermon.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "sermon"}.pdf`;

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
