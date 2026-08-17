import { NextResponse } from "next/server";
import { listSlideThemesForChurch } from "@/lib/queries/slide-themes";
import { getCurrentChurchId } from "@/lib/queries/dashboard";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
// Church uploads are part of the response, so this can't be cached globally.
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    const churchId = user ? await getCurrentChurchId(supabase, user.id) : null;
    const themes = await listSlideThemesForChurch(churchId);

    return NextResponse.json({ themes });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not load themes";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
