import { NextResponse } from "next/server";
import { planPdfFileName, renderPlanPdf } from "@/lib/service-plans/pdf";
import { sharedPreset } from "@/lib/service-plans/types";
import { loadSharedPlanByToken, shareViewOptions } from "../load";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The PDF of exactly what a share link shows. Public by design: the token is
 * the credential, checked (hash, expiry, revocation) before anything is read,
 * and the view is narrowed to the link's preset before it is rendered.
 */
export async function GET(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const loaded = await loadSharedPlanByToken(token);
  if (!loaded) {
    return NextResponse.json({ error: "This link isn't working." }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const { share, plan, church } = loaded;
  const time = new URL(request.url).searchParams.get("time");
  const timeId = time && plan.times.some((t) => t.id === time) ? time : null;

  try {
    const pdf = await renderPlanPdf({
      plan,
      options: { ...shareViewOptions(share), timeId },
      churchName: church.name,
      timeZone: church.timezone,
      logoSrc: church.logoUrl,
    });
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${planPdfFileName(plan, sharedPreset(share.preset))}"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch (error) {
    console.error("service-plans share pdf:", error instanceof Error ? error.message : error);
    return NextResponse.json({ error: "We couldn't make the PDF. Please try again." }, { status: 500 });
  }
}
