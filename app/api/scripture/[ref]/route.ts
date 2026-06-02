import { NextResponse } from "next/server";
import { requireChurchAuth } from "@/lib/auth/church";
import { fetchPassage } from "@/lib/scripture/esv";

export async function GET(
  _request: Request,
  { params }: { params: { ref: string } },
) {
  try {
    await requireChurchAuth();
    const ref = decodeURIComponent(params.ref);
    const passage = await fetchPassage(ref);
    return NextResponse.json(passage);
  } catch (e) {
    const message = e instanceof Error ? e.message : "Failed to fetch passage";
    const status = message === "Unauthorized" ? 401 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
