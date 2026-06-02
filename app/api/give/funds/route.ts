import { NextResponse } from "next/server";
import { getActiveFundsForChurch } from "@/lib/giving/funds";
import { getChurchBySlug } from "@/lib/queries/giving";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const slug = searchParams.get("slug");
  if (!slug) {
    return NextResponse.json({ error: "slug required" }, { status: 400 });
  }

  const church = await getChurchBySlug(slug);
  if (!church?.stripeChargesEnabled) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const funds = await getActiveFundsForChurch(church.churchId);
  return NextResponse.json({ funds });
}
