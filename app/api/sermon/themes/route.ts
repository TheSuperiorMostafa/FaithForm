import { NextResponse } from "next/server";
import { listSlideThemesForChurch } from "@/lib/queries/slide-themes";
import { getCurrentChurchId } from "@/lib/auth/current-church";
import { createClient } from "@/lib/supabase/server";
import { sermonRouteError } from "@/lib/sermon-builder/route-error";

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
    return sermonRouteError(e, "We couldn't load the slide themes.");
  }
}
