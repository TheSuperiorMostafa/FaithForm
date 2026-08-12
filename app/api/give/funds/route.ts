import { NextResponse } from "next/server";
import { isChurchFeatureEnabled } from "@/lib/features/access";
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

  // Giving switched off in the control center stops new money moving. Donor
  // paths that only stop or view an existing gift stay open — a church can
  // turn a feature off, but a donor must always be able to cancel.
  if (!(await isChurchFeatureEnabled(church.churchId, "giving"))) {
    return NextResponse.json({ error: "Giving not available" }, { status: 404 });
  }

  const funds = await getActiveFundsForChurch(church.churchId);
  return NextResponse.json({ funds });
}
