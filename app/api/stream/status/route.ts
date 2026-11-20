import { NextResponse } from "next/server";
import { getChurchAuth } from "@/lib/auth/church";
import { featureAccessDenied } from "@/lib/features/guard";
import { getBroadcastOverview } from "@/lib/stream/broadcast-overview";
import { getLiveBroadcastStatus } from "@/lib/stream/go-live";
import { endLiveServiceIfVideoStopped } from "@/lib/stream/video-stop-end";
import { createClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = createClient();
  const auth = await getChurchAuth(supabase);
  if (!auth) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const denied = await featureAccessDenied("live_stream", supabase);
  if (denied) return denied;

  const read = () =>
    Promise.all([
      getLiveBroadcastStatus(auth.churchId, supabase),
      // Derived from the server's own evidence — never from what this browser
      // believes it pressed.
      getBroadcastOverview(auth.churchId, { includePreview: auth.isAdmin }),
    ]);

  let [status, overview] = await read();

  // The streaming software stopped and its grace window is over. The cron
  // ends it too, but while someone is watching this screen it ends on time,
  // exactly as End service would. The decision is the server's own, from relay
  // evidence, so it does not matter which staff member's poll arrives first.
  if (overview.autoEnd?.due && overview.session) {
    const ended = await endLiveServiceIfVideoStopped(auth.churchId, { expectedSessionId: overview.session.id });
    if (ended) [status, overview] = await read();
  }

  return NextResponse.json(
    { ...status, overview },
    { headers: { "Cache-Control": "no-store" } },
  );
}
