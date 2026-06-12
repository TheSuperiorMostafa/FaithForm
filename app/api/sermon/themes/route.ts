import { NextResponse } from "next/server";
import { listSlideThemes } from "@/lib/queries/slide-themes";

export const runtime = "nodejs";
export const revalidate = 300;

export async function GET() {
  try {
    const themes = await listSlideThemes();
    return NextResponse.json({ themes });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load themes";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
