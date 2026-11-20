import { NextResponse } from "next/server";
import QRCode from "qrcode";

import {
  appDownloadUrl,
  fileStem,
  flyerColors,
  qrSvg,
} from "@/components/church-app/app-flyer-content";
import { loadChurchFlyerData } from "@/components/church-app/app-flyer-data";
import { requireFeatureApi } from "@/lib/features/guard";

export const runtime = "nodejs";

/**
 * The church's "Get the app" QR code, in its app color, as PNG (default) or
 * SVG. Staff only, for the church in the caller's own session.
 */
export async function GET(request: Request) {
  const guard = await requireFeatureApi("member_app");
  if (!guard.ok) return guard.response;
  const churchId = guard.access.auth.churchId;
  if (!churchId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const params = new URL(request.url).searchParams;
  const format = params.get("format") === "svg" ? "svg" : "png";
  const asDownload = params.get("download") === "1";

  const church = await loadChurchFlyerData(churchId);
  if (!church) {
    return NextResponse.json({ error: "We couldn't make your QR code. Please try again." }, { status: 500 });
  }

  const ink = flyerColors(church.primaryColor, church.accentColor).qrInk;
  const url = appDownloadUrl();
  const name = `${fileStem(church.churchName)}-app-qr-code.${format}`;
  const headers: Record<string, string> = { "Cache-Control": "private, no-store" };
  if (asDownload) headers["Content-Disposition"] = `attachment; filename="${name}"`;

  if (format === "svg") {
    return new NextResponse(qrSvg(url, ink), {
      headers: { ...headers, "Content-Type": "image/svg+xml; charset=utf-8" },
    });
  }

  const png = await QRCode.toBuffer(url, {
    type: "png",
    width: 1024,
    margin: 4,
    errorCorrectionLevel: "M",
    color: { dark: ink, light: "#FFFFFF" },
  });
  return new NextResponse(new Uint8Array(png), {
    headers: { ...headers, "Content-Type": "image/png" },
  });
}
