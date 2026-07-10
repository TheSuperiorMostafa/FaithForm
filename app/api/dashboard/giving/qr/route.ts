import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import { getChurchGivingProfile } from "@/lib/queries/giving";
import { getGivePageUrl } from "@/lib/stripe/config";
import { getCanonicalSiteUrl } from "@/lib/site-url";
import QRCode from "qrcode";

function isAllowedGiveUrl(url: string, slug: string): boolean {
  try {
    const parsed = new URL(url);
    const canonicalOrigin = new URL(getCanonicalSiteUrl()).origin;
    if (parsed.origin !== canonicalOrigin) {
      return false;
    }

    const giveBase = getGivePageUrl(slug);
    return url === giveBase || url.startsWith(`${giveBase}/`);
  } catch {
    return false;
  }
}

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

  const profile = await getChurchGivingProfile(auth.churchId);
  if (!profile?.slug) {
    return NextResponse.json({ error: "Giving page not configured" }, { status: 400 });
  }

  if (!isAllowedGiveUrl(url, profile.slug)) {
    return NextResponse.json({ error: "URL not allowed" }, { status: 400 });
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
