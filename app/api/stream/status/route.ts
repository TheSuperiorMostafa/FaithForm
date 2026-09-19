import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import { featureAccessDenied } from "@/lib/features/guard";
import { getBroadcastOverview } from "@/lib/stream/broadcast-overview";
import { getLiveBroadcastStatus } from "@/lib/stream/go-live";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const denied = await featureAccessDenied("live_stream", supabase);
  if (denied) return denied;

  const [status, overview] = await Promise.all([
    getLiveBroadcastStatus(auth.churchId, supabase),
    // Derived from the server's own evidence — never from what this browser
    // believes it pressed.
    getBroadcastOverview(auth.churchId, { includePreview: auth.isAdmin }),
  ]);
  return NextResponse.json(
    { ...status, overview },
    { headers: { "Cache-Control": "no-store" } },
  );
}
