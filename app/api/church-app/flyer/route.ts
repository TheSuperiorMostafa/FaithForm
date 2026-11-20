import { NextResponse } from "next/server";

import { appDownloadUrl, fileStem } from "@/components/church-app/app-flyer-content";
import { fetchLogoPng, loadChurchFlyerData } from "@/components/church-app/app-flyer-data";
import { renderAppFlyerPdf } from "@/components/church-app/app-flyer-pdf";
import { requireFeatureApi } from "@/lib/features/guard";

export const runtime = "nodejs";

/**
 * A letter-size "Our church has an app" flyer as a PDF, in the church's app
 * colors with its name, logo and QR code. Staff only, for the church in the
 * caller's own session.
 */
export async function GET() {
  const guard = await requireFeatureApi("member_app");
  if (!guard.ok) return guard.response;
  const churchId = guard.access.auth.churchId;
  if (!churchId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const church = await loadChurchFlyerData(churchId);
  if (!church) {
    return NextResponse.json({ error: "We couldn't make your flyer. Please try again." }, { status: 500 });
  }

  try {
    const pdf = await renderAppFlyerPdf({
      churchName: church.churchName,
      primaryColor: church.primaryColor,
      accentColor: church.accentColor,
      logoPng: await fetchLogoPng(church.logoUrl),
      findableInSearch: church.findableInSearch,
      downloadUrl: appDownloadUrl(),
    });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${fileStem(church.churchName)}-app-flyer.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) {
    console.error("[church-app/flyer] render failed", error instanceof Error ? error.message : "unknown");
    return NextResponse.json({ error: "We couldn't make your flyer. Please try again." }, { status: 500 });
  }
}
