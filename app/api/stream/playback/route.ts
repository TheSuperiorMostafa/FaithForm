import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import { featureAccessDenied } from "@/lib/features/guard";
import { getHlsPlaybackUrl } from "@/lib/stream/playback";
import { createClient } from "@/lib/supabase/server";
import { getActiveStreamSession } from "@/lib/stream/sessions";

export async function GET() {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth?.isAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const denied = await featureAccessDenied("live_stream", supabase);
  if (denied) return denied;

  const session = await getActiveStreamSession(auth.churchId, supabase);
  const playbackUrl = session?.streamEventId
    ? getHlsPlaybackUrl({
        churchId: auth.churchId,
        eventId: session.streamEventId,
        audience: "staff",
      })
    : null;
  return NextResponse.json(
    { playbackUrl },
    { headers: { "Cache-Control": "no-store" } },
  );
}
