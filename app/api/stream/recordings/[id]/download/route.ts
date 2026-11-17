import { NextResponse } from "next/server";

import { requireFeatureApi } from "@/lib/features/guard";
import { getRecordingDownload } from "@/lib/stream/recording-download";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";
const HEADERS = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };

/** A private download plan, never a public endpoint or an arbitrary storage proxy. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const access = await requireFeatureApi("live_stream");
  if (!access.ok) {
    access.response.headers.set("Cache-Control", HEADERS["Cache-Control"]);
    return access.response;
  }
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: "That recording is no longer available." }, { status: 404, headers: HEADERS });
  }
  try {
    const result = await getRecordingDownload(access.access.auth.churchId, id, createAdminClient());
    return result.ok
      ? NextResponse.json(result.download, { headers: HEADERS })
      : NextResponse.json({ error: result.error }, { status: result.status, headers: HEADERS });
  } catch {
    return NextResponse.json({ error: "We couldn't prepare this download. Please try again." }, { status: 503, headers: HEADERS });
  }
}
