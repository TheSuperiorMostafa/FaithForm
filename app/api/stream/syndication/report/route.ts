import { NextResponse } from "next/server";
import { compareSecret } from "@/lib/security/compare-secret";
import { parseStreamPath } from "@/lib/stream/relay";
import { recordSyndicationAttempt } from "@/lib/stream/syndication";
import { createAdminClient } from "@/lib/supabase/admin";

const PLATFORMS = new Set(["youtube", "facebook"]);
const STATUSES = new Set(["pending", "success", "failed"]);

/**
 * How the relay tells FaithForm whether a platform push is actually running.
 *
 * Without this the dashboard only knew that an RTMP destination had been handed
 * out, and reported "Push destination ready" for the whole service while ffmpeg
 * was crash-looping against a destination it could not reach. Provisioning is
 * the promise; this is the delivery.
 */
export async function POST(request: Request) {
  const providedSecret = request.headers.get("x-stream-relay-secret");
  const expectedSecret = process.env.STREAM_RELAY_WEBHOOK_SECRET;

  if (!compareSecret(providedSecret, expectedSecret)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: {
    path?: string;
    platform?: string;
    status?: string;
    error?: string | null;
  };

  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const parsed = parseStreamPath(body.path ?? "");
  if (!parsed || parsed.legacyCredentialInPath) {
    return NextResponse.json({ error: "Invalid stream path" }, { status: 400 });
  }

  const platform = body.platform ?? "";
  const status = body.status ?? "";

  if (!PLATFORMS.has(platform) || !STATUSES.has(status)) {
    return NextResponse.json(
      { error: "Unknown platform or status" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();

  // Attach the report to the church's current service. Without one there is
  // nothing to attach it to and nothing to show, so drop it quietly rather
  // than failing a relay call that must never block a broadcast.
  const { data: events } = await admin
    .from("stream_events")
    .select("id")
    .eq("church_id", parsed.churchId)
    .order("starts_at", { ascending: false })
    .limit(1);

  const eventId = events?.[0]?.id as string | undefined;
  if (!eventId) return NextResponse.json({ ok: true, recorded: false });

  await recordSyndicationAttempt(
    eventId,
    platform as "youtube" | "facebook",
    status as "pending" | "success" | "failed",
    body.error?.slice(0, 500) ?? undefined,
    admin,
  );

  return NextResponse.json({ ok: true, recorded: true });
}
