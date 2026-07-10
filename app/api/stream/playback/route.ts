import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import { getHlsPlaybackUrl } from "@/lib/stream/playback";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const playbackUrl = await getHlsPlaybackUrl(auth.churchId, { supabase });
  return NextResponse.json({ playbackUrl });
}
