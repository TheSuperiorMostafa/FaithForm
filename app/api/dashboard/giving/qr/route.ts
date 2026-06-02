import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import QRCode from "qrcode";

export async function GET(request: Request) {
  const auth = await getChurchAuth();
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const url = searchParams.get("url");
  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }

  const png = await QRCode.toBuffer(url, {
    type: "png",
    width: 400,
    margin: 2,
  });

  return new NextResponse(new Uint8Array(png), {
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=3600",
    },
  });
}
